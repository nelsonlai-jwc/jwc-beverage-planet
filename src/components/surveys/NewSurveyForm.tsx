"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  cardClass,
  errorText,
  inputClass,
  labelClass,
  mutedText,
  primaryButton,
  secondaryButton,
} from "@/components/ui/styles";
import { toast } from "@/components/ui/toast";
import { Link, useRouter } from "@/i18n/navigation";
import type { Outlet } from "@/lib/auth/currentUser";
import { createClient } from "@/lib/supabase/client";
import { OutletChecklist } from "@/components/recipes/OutletChecklist";
import {
  ESPRESSO_DRINKS,
  type Audience,
  type SubjectType,
  type SurveyDrink,
} from "@/lib/tasting/scale";

/** A calibration record to survey. outletId: the outlet of a daily record, null for a custom one. */
export type RecordOption = {
  id: string;
  outletId: string | null;
  label: string;
  drinks: SurveyDrink[];
};
/** An approved drink recipe; outletIds null means all outlets. */
export type RecipeOption = {
  id: string;
  name: string;
  temperature: string | null;
  outletIds: string[] | null;
};
type Person = { id: string; full_name: string; role: string };

/** CUSTOM: rate something with no record or recipe; it gets a type and a name instead. */
type Subject = SubjectType | "CUSTOM";
const SUBJECTS: Subject[] = ["ESPRESSO", "FILTER", "RECIPE", "CUSTOM"];
const CUSTOM_TYPES: SubjectType[] = ["ESPRESSO", "FILTER", "RECIPE"];
const AUDIENCES: Audience[] = ["OUTLET", "PUBLIC"];

/** How long a survey stays open, in minutes; "none" closes it after 24 hours (database default). */
const DURATIONS = ["15", "30", "60", "300", "none"] as const;
type Duration = (typeof DURATIONS)[number];

const chip = (on: boolean) =>
  `inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold ${
    on ? "border-black bg-black text-white" : "border-black/40 bg-white"
  }`;

export function NewSurveyForm({
  outlets,
  espresso,
  filter,
  recipes,
}: {
  outlets: Outlet[];
  espresso: RecordOption[];
  filter: RecordOption[];
  recipes: RecipeOption[];
}) {
  const t = useTranslations("Surveys");
  const d = useTranslations("Tasting");
  const r = useTranslations("Recipes");
  const router = useRouter();

  const [subject, setSubject] = useState<Subject>("ESPRESSO");
  const [customType, setCustomType] = useState<SubjectType>("ESPRESSO");
  const [title, setTitle] = useState("");
  const [recordId, setRecordId] = useState("");
  const [drinks, setDrinks] = useState<SurveyDrink[]>([]);
  const [recipeId, setRecipeId] = useState("");
  const [audience, setAudience] = useState<Audience>("OUTLET");
  // Ticked outlets, or all of the creator's outlets.
  const [outletIds, setOutletIds] = useState<string[]>(
    outlets[0] ? [outlets[0].id] : [],
  );
  const [allOutlets, setAllOutlets] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [duration, setDuration] = useState<Duration>("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const records =
    subject === "ESPRESSO" ? espresso : subject === "FILTER" ? filter : [];
  const record = records.find((x) => x.id === recordId) ?? null;
  // A daily record's survey always includes the record's outlet (ticked and locked).
  const fixedOutlet =
    (subject === "ESPRESSO" || subject === "FILTER") && record?.outletId
      ? record.outletId
      : null;
  const needsOutlet = subject === "RECIPE" || audience === "OUTLET";
  const tickedOutlets = outlets
    .filter(
      (o) => allOutlets || o.id === fixedOutlet || outletIds.includes(o.id),
    )
    .map((o) => o.id);
  const surveyOutlets = needsOutlet
    ? tickedOutlets
    : fixedOutlet
      ? [fixedOutlet]
      : [];
  const outletKey = audience === "OUTLET" ? tickedOutlets.join(",") : "";
  // A Signature Beverage recipe must be available in every ticked outlet.
  const outletRecipes =
    tickedOutlets.length === 0
      ? []
      : recipes.filter(
          (x) =>
            !x.outletIds ||
            tickedOutlets.every((id) => x.outletIds!.includes(id)),
        );

  useEffect(() => {
    if (!outletKey) return;
    let live = true;
    setPeople(null);
    const supabase = createClient();
    Promise.all(
      outletKey
        .split(",")
        .map((id) => supabase.rpc("survey_outlet_people", { p_outlet_id: id })),
    ).then((results) => {
      if (!live) return;
      // Staff of several ticked outlets appear once.
      const byId = new Map<string, Person>();
      for (const { data } of results)
        for (const p of data ?? []) byId.set(p.id, p);
      const list = [...byId.values()].sort((a, b) =>
        a.full_name.localeCompare(b.full_name),
      );
      setPeople(list);
      setTicked(list.map((p) => p.id));
    });
    return () => {
      live = false;
    };
  }, [outletKey]);

  function pickOutlets(ids: string[], all: boolean) {
    setOutletIds(ids);
    setAllOutlets(all);
    const next = outlets
      .filter((o) => all || o.id === fixedOutlet || ids.includes(o.id))
      .map((o) => o.id);
    const recipe = recipes.find((x) => x.id === recipeId);
    if (
      recipe?.outletIds &&
      !next.every((id) => recipe.outletIds!.includes(id))
    )
      setRecipeId("");
  }

  const outletPicker = (
    <div className="flex flex-col gap-1.5">
      <span className={labelClass}>{t("outlet")}</span>
      <OutletChecklist
        outlets={outlets}
        allowAll
        outletIds={
          fixedOutlet && !outletIds.includes(fixedOutlet)
            ? [...outletIds, fixedOutlet]
            : outletIds
        }
        allOutlets={allOutlets}
        onChange={pickOutlets}
        editableIds={
          fixedOutlet
            ? outlets.filter((o) => o.id !== fixedOutlet).map((o) => o.id)
            : undefined
        }
      />
    </div>
  );

  function pickSubject(next: Subject) {
    setSubject(next);
    setRecordId("");
    setDrinks([]);
    setRecipeId("");
    setError(null);
  }

  function pickRecord(id: string) {
    setRecordId(id);
    setDrinks(espresso.find((x) => x.id === id)?.drinks ?? []);
  }

  function pickCustomType(next: SubjectType) {
    setCustomType(next);
    setDrinks([]);
    setError(null);
  }

  async function create() {
    setError(null);
    const custom = subject === "CUSTOM";
    // A custom survey uses the score sheets of its type.
    const type = custom ? customType : subject;
    if (custom ? !title.trim() : subject === "RECIPE" ? !recipeId : !record)
      return setError(custom ? t("pickName") : t("pickSubject"));
    if (type === "ESPRESSO" && drinks.length === 0)
      return setError(t("pickDrinks"));
    if (needsOutlet && surveyOutlets.length === 0)
      return setError(t("pickOutlet"));
    if (audience === "OUTLET" && ticked.length === 0)
      return setError(t("pickPeople"));

    setBusy(true);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("surveys")
      .insert({
        subject_type: type,
        title: custom ? title.trim() : null,
        calibration_id: subject === "ESPRESSO" ? recordId : null,
        filter_calibration_id: subject === "FILTER" ? recordId : null,
        recipe_id: subject === "RECIPE" ? recipeId : null,
        outlet_ids: surveyOutlets,
        audience,
        drinks:
          type === "ESPRESSO"
            ? drinks
            : type === "FILTER"
              ? ["FILTER"]
              : ["RECIPE"],
        note: note.trim() || null,
        ...(duration !== "none"
          ? {
              closes_at: new Date(
                Date.now() + Number(duration) * 60e3,
              ).toISOString(),
            }
          : {}),
      })
      .select("id")
      .single();
    if (insertError || !data) {
      setBusy(false);
      return setError(t("saveFailed"));
    }
    if (audience === "OUTLET") {
      const { error: inviteError } = await supabase
        .from("survey_invitees")
        .insert(ticked.map((user_id) => ({ survey_id: data.id, user_id })));
      if (inviteError) {
        setBusy(false);
        setError(t("saveFailed"));
        router.push(`/surveys/${data.id}`);
        return;
      }
    }
    toast("saved");
    router.push(`/surveys/${data.id}`);
  }

  return (
    <div className={`${cardClass} flex flex-col gap-5`}>
      <div className="flex flex-col gap-2">
        <span className={labelClass}>{t("subjectLabel")}</span>
        <div className="flex flex-wrap gap-2">
          {SUBJECTS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={subject === s}
              onClick={() => pickSubject(s)}
              className={chip(subject === s)}
            >
              {t(`subject.${s}`)}
            </button>
          ))}
        </div>
        <p className={mutedText}>{t(`subjectHint.${subject}`)}</p>
      </div>

      {subject === "CUSTOM" ? (
        <>
          <div className="flex flex-col gap-2">
            <span className={labelClass}>{t("customTypeLabel")}</span>
            <div className="flex flex-wrap gap-2">
              {CUSTOM_TYPES.map((x) => (
                <button
                  key={x}
                  type="button"
                  aria-pressed={customType === x}
                  onClick={() => pickCustomType(x)}
                  className={chip(customType === x)}
                >
                  {t(`customType.${x}`)}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>{t("nameLabel")}</span>
            <input
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </label>
          {customType === "ESPRESSO" && (
            <div className="flex flex-col gap-2">
              <span className={labelClass}>{t("drinksLabel")}</span>
              <div className="flex flex-wrap gap-3">
                {ESPRESSO_DRINKS.map((x) => (
                  <label
                    key={x}
                    className="flex items-center gap-2 text-sm font-semibold"
                  >
                    <input
                      type="checkbox"
                      checked={drinks.includes(x)}
                      onChange={(e) =>
                        setDrinks(
                          e.target.checked
                            ? [...drinks, x]
                            : drinks.filter((y) => y !== x),
                        )
                      }
                      className="h-5 w-5 accent-black"
                    />
                    {d(`drink.${x}`)}
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      ) : subject === "RECIPE" ? (
        <>
          {outletPicker}
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>{t("recipe")}</span>
            <select
              value={recipeId}
              onChange={(e) => setRecipeId(e.target.value)}
              className={inputClass}
            >
              <option value="">{t("choose")}</option>
              {outletRecipes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.temperature ? ` (${r(`temp.${x.temperature}`)})` : ""}
                </option>
              ))}
            </select>
            {outletRecipes.length === 0 && (
              <span className={mutedText}>{t("noRecipes")}</span>
            )}
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>{t("record")}</span>
          <select
            value={recordId}
            onChange={(e) => pickRecord(e.target.value)}
            className={inputClass}
          >
            <option value="">{t("choose")}</option>
            {records.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <span className={mutedText}>
            {records.length === 0 ? t("noRecords") : t("recordHint")}
          </span>
        </label>
      )}

      {subject === "ESPRESSO" && record && (
        <div className="flex flex-col gap-2">
          <span className={labelClass}>{t("drinksLabel")}</span>
          <div className="flex flex-wrap gap-3">
            {record.drinks.map((x) => (
              <label
                key={x}
                className="flex items-center gap-2 text-sm font-semibold"
              >
                <input
                  type="checkbox"
                  checked={drinks.includes(x)}
                  onChange={(e) =>
                    setDrinks(
                      e.target.checked
                        ? [...drinks, x]
                        : drinks.filter((y) => y !== x),
                    )
                  }
                  className="h-5 w-5 accent-black"
                />
                {d(`drink.${x}`)}
              </label>
            ))}
          </div>
          <p className={mutedText}>{t("drinksHint")}</p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className={labelClass}>{t("audienceLabel")}</span>
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map((a) => (
            <button
              key={a}
              type="button"
              aria-pressed={audience === a}
              onClick={() => setAudience(a)}
              className={chip(audience === a)}
            >
              {t(`audience.${a}`)}
            </button>
          ))}
        </div>
        <p className={mutedText}>{t(`audienceHint.${audience}`)}</p>
      </div>

      {audience === "OUTLET" && (
        <div className="flex flex-col gap-3">
          {subject !== "RECIPE" && outletPicker}
          {outletKey !== "" && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <span className={labelClass}>
                  {t("peopleLabel", { count: ticked.length })}
                </span>
                {people && people.length > 0 && (
                  <button
                    type="button"
                    className="text-sm font-semibold underline"
                    onClick={() =>
                      setTicked(
                        ticked.length === people.length
                          ? []
                          : people.map((p) => p.id),
                      )
                    }
                  >
                    {ticked.length === people.length
                      ? t("tickNone")
                      : t("tickAll")}
                  </button>
                )}
              </div>
              {people === null ? (
                <p className={mutedText}>{t("loading")}</p>
              ) : people.length === 0 ? (
                <p className={mutedText}>{t("noPeople")}</p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {people.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={ticked.includes(p.id)}
                        onChange={(e) =>
                          setTicked(
                            e.target.checked
                              ? [...ticked, p.id]
                              : ticked.filter((x) => x !== p.id),
                          )
                        }
                        className="h-5 w-5 accent-black"
                      />
                      <span className="font-semibold">{p.full_name}</span>
                      <span className={mutedText}>{t(`role.${p.role}`)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className={labelClass}>{t("deadline")}</span>
        <div className="flex flex-wrap gap-2">
          {DURATIONS.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={duration === x}
              onClick={() => setDuration(x)}
              className={chip(duration === x)}
            >
              {t(`duration.${x}`)}
            </button>
          ))}
        </div>
        <span className={mutedText}>{t("deadlineHint")}</span>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>{t("noteLabel")}</span>
        <input
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          className={inputClass}
        />
      </label>

      {error && <p className={errorText}>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={create}
          className={primaryButton}
        >
          {t("create")}
        </button>
        <Link href="/surveys" className={secondaryButton}>
          {t("cancel")}
        </Link>
      </div>
    </div>
  );
}
