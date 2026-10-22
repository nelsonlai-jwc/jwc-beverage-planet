import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { asCost, type CostResult, type FullVersion, type Outlet, type Viewer } from "./types";

type Client = SupabaseClient<Database>;

export const MEDIA_BUCKET = "recipe-media";

export async function getViewer(supabase: Client): Promise<Viewer | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.status !== "ACTIVE") return null;

  let managedOutletIds: string[] = [];
  if (profile.role === "ADMIN") {
    const { data } = await supabase.from("outlets").select("id").eq("is_active", true);
    managedOutletIds = (data ?? []).map((o) => o.id);
  } else if (profile.role === "MANAGER") {
    const { data } = await supabase.from("user_outlets").select("outlet_id").eq("user_id", user.id);
    managedOutletIds = (data ?? []).map((o) => o.outlet_id);
  }
  return { id: user.id, role: profile.role, managedOutletIds };
}

export async function getOutlets(supabase: Client): Promise<Outlet[]> {
  const { data } = await supabase.from("outlets").select("id, name").order("name");
  return data ?? [];
}

// Display name per recipe: its approved version's name, else its latest version's.
export async function getRecipeNames(supabase: Client, recipeIds: string[]) {
  const names = new Map<string, string>();
  if (!recipeIds.length) return names;
  const { data: recipes } = await supabase
    .from("recipes")
    .select("id, current_approved_version_id")
    .in("id", recipeIds);
  const { data: versions } = await supabase
    .from("recipe_versions")
    .select("id, recipe_id, version_no, product_name")
    .in("recipe_id", recipeIds)
    .order("version_no", { ascending: false });
  for (const r of recipes ?? []) {
    const own = (versions ?? []).filter((v) => v.recipe_id === r.id);
    const pick = own.find((v) => v.id === r.current_approved_version_id) ?? own[0];
    names.set(r.id, pick?.product_name ?? "—");
  }
  return names;
}

export async function signPhotos(supabase: Client, mediaIds: string[]) {
  const urls = new Map<string, string | null>();
  if (!mediaIds.length) return urls;
  const { data: assets } = await supabase
    .from("media_assets")
    .select("id, object_path")
    .in("id", mediaIds);
  const paths = (assets ?? []).map((a) => a.object_path);
  const { data: signed } = paths.length
    ? await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(paths, 3600)
    : { data: [] };
  for (const asset of assets ?? []) {
    const hit = (signed ?? []).find((s) => s.path === asset.object_path);
    urls.set(asset.id, hit?.signedUrl ?? null);
  }
  return urls;
}

export async function loadFullVersion(supabase: Client, versionId: string): Promise<FullVersion | null> {
  const { data: version } = await supabase
    .from("recipe_versions")
    .select("*")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) return null;

  const [ingredients, packaging, steps, media] = await Promise.all([
    supabase.from("recipe_ingredients").select("*").eq("recipe_version_id", versionId).order("sort_order"),
    supabase.from("recipe_packaging").select("*").eq("recipe_version_id", versionId).order("sort_order"),
    supabase.from("recipe_steps").select("*").eq("recipe_version_id", versionId).order("step_no"),
    supabase.from("recipe_media").select("media_asset_id").eq("recipe_version_id", versionId).order("sort_order"),
  ]);

  const materialIds = (ingredients.data ?? []).flatMap((i) => (i.material_id ? [i.material_id] : []));
  const prepIds = (ingredients.data ?? []).flatMap((i) => (i.prep_recipe_id ? [i.prep_recipe_id] : []));
  const packagingIds = (packaging.data ?? []).map((p) => p.packaging_item_id);
  const [materials, prepNames, packagingItems, photoUrls] = await Promise.all([
    materialIds.length
      ? supabase.from("materials").select("id, name, brand").in("id", materialIds)
      : Promise.resolve({ data: [] as { id: string; name: string; brand: string | null }[] }),
    getRecipeNames(supabase, prepIds),
    packagingIds.length
      ? supabase.from("packaging_items").select("id, name, brand").in("id", packagingIds)
      : Promise.resolve({ data: [] as { id: string; name: string; brand: string | null }[] }),
    signPhotos(supabase, (media.data ?? []).map((m) => m.media_asset_id)),
  ]);

  const label = (item?: { name: string; brand: string | null }) =>
    item ? (item.brand ? `${item.name} (${item.brand})` : item.name) : "—";

  return {
    ...version,
    ingredients: (ingredients.data ?? []).map((i) => ({
      ...i,
      isPrep: Boolean(i.prep_recipe_id),
      name: i.prep_recipe_id
        ? (prepNames.get(i.prep_recipe_id) ?? "—")
        : label((materials.data ?? []).find((m) => m.id === i.material_id)),
    })),
    packaging: (packaging.data ?? []).map((p) => ({
      ...p,
      name: label((packagingItems.data ?? []).find((m) => m.id === p.packaging_item_id)),
    })),
    steps: steps.data ?? [],
    photos: (media.data ?? []).map((m) => ({ id: m.media_asset_id, url: photoUrls.get(m.media_asset_id) ?? null })),
  };
}

// calculate_recipe_cost is defined by the raw-material track; null when it is
// not installed yet or the viewer may not see this outlet's cost.
export async function getRecipeCost(supabase: Client, versionId: string): Promise<CostResult | null> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: Json | null; error: unknown }>;
  const { data, error } = await rpc("calculate_recipe_cost", { p_version_id: versionId });
  return error ? null : asCost(data);
}
