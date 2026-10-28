import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import type { Database } from "@/types/database";
import { sendEmail } from "./resend";

export type ReviewedKind = "material" | "pack" | "price" | "packaging" | "packagingPrice" | "recipe" | "change";

type Client = SupabaseClient<Database>;

type Subject = {
  submitterId: string | null;
  name: string;
  kindEn: string;
  kindZh: string;
  path: string;
};

const ENTITY: Record<Exclude<ReviewedKind, "change" | "recipe">, string> = {
  material: "MATERIAL",
  pack: "MATERIAL_PACK",
  price: "MATERIAL_PRICE",
  packaging: "PACKAGING_ITEM",
  packagingPrice: "PACKAGING_PRICE",
};

/** Who sent the item for approval: the latest SUBMIT event on it. */
async function lastSubmitter(supabase: Client, entityType: string, id: string) {
  const { data } = await supabase
    .from("approval_events")
    .select("actor_id")
    .eq("entity_type", entityType)
    .eq("entity_id", id)
    .eq("action", "SUBMIT")
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.actor_id ?? null;
}

async function materialName(supabase: Client, id: string) {
  const { data } = await supabase.from("materials").select("name, brand").eq("id", id).maybeSingle();
  return data ? [data.name, data.brand].filter(Boolean).join(" · ") : "";
}

async function packagingName(supabase: Client, id: string) {
  const { data } = await supabase.from("packaging_items").select("name, brand").eq("id", id).maybeSingle();
  return data ? [data.name, data.brand].filter(Boolean).join(" · ") : "";
}

async function recipeName(supabase: Client, recipeId: string) {
  const { data } = await supabase
    .from("recipe_versions")
    .select("product_name")
    .eq("recipe_id", recipeId)
    .order("version_no", { ascending: false })
    .limit(1);
  return data?.[0]?.product_name ?? "";
}

async function describe(supabase: Client, kind: ReviewedKind, id: string): Promise<Subject | null> {
  switch (kind) {
    case "material":
      return {
        submitterId: await lastSubmitter(supabase, ENTITY.material, id),
        name: await materialName(supabase, id),
        kindEn: "Raw material",
        kindZh: "原料",
        path: `/raw-materials/${id}`,
      };
    case "pack": {
      const { data } = await supabase
        .from("material_packs")
        .select("material_id, pack_quantity, unit")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      return {
        submitterId: await lastSubmitter(supabase, ENTITY.pack, id),
        name: `${await materialName(supabase, data.material_id)} · ${Number(data.pack_quantity)} ${data.unit}`,
        kindEn: "New pack size",
        kindZh: "新包装规格",
        path: `/raw-materials/${data.material_id}`,
      };
    }
    case "price": {
      const { data } = await supabase
        .from("material_price_versions")
        .select("material_packs(material_id, pack_quantity, unit)")
        .eq("id", id)
        .maybeSingle();
      const pack = data?.material_packs;
      if (!pack) return null;
      return {
        submitterId: await lastSubmitter(supabase, ENTITY.price, id),
        name: `${await materialName(supabase, pack.material_id)} · ${Number(pack.pack_quantity)} ${pack.unit}`,
        kindEn: "Price change",
        kindZh: "价格修改",
        path: `/raw-materials/${pack.material_id}`,
      };
    }
    case "packaging":
      return {
        submitterId: await lastSubmitter(supabase, ENTITY.packaging, id),
        name: await packagingName(supabase, id),
        kindEn: "Packaging",
        kindZh: "包装",
        path: `/raw-materials/packaging/${id}`,
      };
    case "packagingPrice": {
      const { data } = await supabase
        .from("packaging_prices")
        .select("packaging_item_id")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      return {
        submitterId: await lastSubmitter(supabase, ENTITY.packagingPrice, id),
        name: await packagingName(supabase, data.packaging_item_id),
        kindEn: "Packaging price change",
        kindZh: "包装价格修改",
        path: `/raw-materials/packaging/${data.packaging_item_id}`,
      };
    }
    case "recipe": {
      const { data } = await supabase
        .from("recipe_versions")
        .select("recipe_id, version_no, product_name")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      return {
        submitterId: await lastSubmitter(supabase, "RECIPE_VERSION", id),
        name: `${data.product_name ?? ""} V${data.version_no}`,
        kindEn: "Recipe",
        kindZh: "配方",
        path: `/recipes/${data.recipe_id}`,
      };
    }
    case "change": {
      const { data } = await supabase
        .from("change_requests")
        .select("entity_type, entity_id, action, requested_by")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      const isEdit = data.action === "EDIT";
      const entity =
        data.entity_type === "MATERIAL"
          ? { name: await materialName(supabase, data.entity_id), path: `/raw-materials/${data.entity_id}` }
          : data.entity_type === "RECIPE"
            ? { name: await recipeName(supabase, data.entity_id), path: `/recipes/${data.entity_id}` }
            : {
                name: await packagingName(supabase, data.entity_id),
                path: `/raw-materials/packaging/${data.entity_id}`,
              };
      return {
        submitterId: data.requested_by,
        name: entity.name,
        kindEn: isEdit ? "Edit request" : "Delete request",
        kindZh: isEdit ? "修改申请" : "删除申请",
        path: entity.path,
      };
    }
  }
}

function escape(text: string) {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/**
 * Emails the person who submitted an item the Admin's decision (O16).
 * Best effort: a failed email never undoes or blocks the review.
 */
export async function notifyReviewResult(
  supabase: Client,
  review: { kind: ReviewedKind; id: string; approved: boolean; reason?: string },
) {
  try {
    const subject = await describe(supabase, review.kind, review.id);
    if (!subject?.submitterId) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (subject.submitterId === user?.id) return;
    const { data: person } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", subject.submitterId)
      .maybeSingle();
    if (!person?.email) return;

    const h = await headers();
    const url = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}/en${subject.path}`;
    const reason = review.reason?.trim() ?? "";
    const en = review.approved ? "approved" : "returned";
    const zh = review.approved ? "已批准" : "已退回";

    const text = [
      `${subject.kindEn} "${subject.name}" was ${en} by Admin.`,
      ...(!review.approved && reason ? [`Reason: ${reason}`] : []),
      url,
      "",
      `${subject.kindZh}「${subject.name}」${zh}。`,
      ...(!review.approved && reason ? [`原因：${reason}`] : []),
      url,
    ].join("\n");
    const reasonHtml = (label: string) =>
      !review.approved && reason ? `<p>${label}${escape(reason)}</p>` : "";
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#000">
<p>${escape(subject.kindEn)} <strong>${escape(subject.name)}</strong> was ${en} by Admin.</p>
${reasonHtml("Reason: ")}
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#000;color:#fff;border-radius:999px;text-decoration:none">Open</a></p>
<hr style="border:none;border-top:1px solid #c7c9c2;margin:24px 0">
<p>${escape(subject.kindZh)}<strong>「${escape(subject.name)}」</strong>${zh}。</p>
${reasonHtml("原因：")}
<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#000;color:#fff;border-radius:999px;text-decoration:none">打开</a></p>
</div>`;

    await sendEmail({
      to: person.email,
      subject: `${review.approved ? "Approved" : "Returned"}: ${subject.name} / ${zh}：${subject.name}`,
      text,
      html,
    });
  } catch (error) {
    console.error("Review email failed", error);
  }
}
