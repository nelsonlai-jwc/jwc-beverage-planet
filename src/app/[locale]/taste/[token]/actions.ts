"use server";

import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { CRITERIA, FLAVOR_TAGS, MILK_AMOUNTS, isScore, type Criterion, type Drink, type MilkAmount } from "@/lib/tasting/scale";

const DEVICE_COOKIE = "jwc_taster";

export type TastingAnswer = {
  drink: Drink;
  scores: Partial<Record<Criterion, number>>;
  flavorTags: string[];
  milkAmount: MilkAmount | null;
  comment: string;
};

export type TastingResult = { ok: true } | { ok: false; error: "INVALID" | "CLOSED" | "ALREADY" | "TOO_MANY" | "NOT_FOUND" | "UNKNOWN" };

/** Saves one answer. The phone is remembered by a cookie, the network by a hash of its address. */
export async function submitTasting(token: string, answer: TastingAnswer): Promise<TastingResult> {
  const criteria = CRITERIA[answer.drink];
  if (!criteria || !criteria.every((c) => isScore(answer.scores[c]))) return { ok: false, error: "INVALID" };
  if (answer.drink === "MILK" && !MILK_AMOUNTS.includes(answer.milkAmount as MilkAmount)) return { ok: false, error: "INVALID" };
  const tags = answer.flavorTags.filter((tag) => (FLAVOR_TAGS as readonly string[]).includes(tag));

  const jar = await cookies();
  let device = jar.get(DEVICE_COOKIE)?.value;
  if (!device || device.length < 16 || device.length > 64) {
    device = randomUUID();
    jar.set(DEVICE_COOKIE, device, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 60 * 60 * 24 * 365, path: "/" });
  }
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  const ipHash = forwarded ? createHash("sha256").update(`${token}:${forwarded}`).digest("hex").slice(0, 32) : null;

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_tasting_response", {
    p_token: token,
    p_drink: answer.drink,
    p_visual: answer.drink === "MILK" ? answer.scores.visual! : null,
    p_taste_balance: answer.scores.taste_balance!,
    p_tactile: answer.scores.tactile!,
    p_flavor: answer.scores.flavor!,
    p_flavor_tags: tags,
    p_milk_amount: answer.drink === "MILK" ? answer.milkAmount : null,
    p_comment: answer.comment.trim().slice(0, 140) || null,
    p_device_id: device,
    p_ip_hash: ipHash,
  });
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, error: "ALREADY" };
  if (error.code === "55000") return { ok: false, error: "CLOSED" };
  if (error.code === "54000") return { ok: false, error: "TOO_MANY" };
  if (error.code === "P0002") return { ok: false, error: "NOT_FOUND" };
  if (error.code === "23514") return { ok: false, error: "INVALID" };
  return { ok: false, error: "UNKNOWN" };
}
