import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/** One-hour signed URL for a stored photo, or null when there is none or it can't be read. */
export async function signedMediaUrl(supabase: SupabaseClient<Database>, assetId: string | null) {
  if (!assetId) return null;
  const { data: asset } = await supabase
    .from("media_assets")
    .select("bucket, object_path")
    .eq("id", assetId)
    .maybeSingle();
  if (!asset) return null;
  const { data } = await supabase.storage.from(asset.bucket).createSignedUrl(asset.object_path, 3600);
  return data?.signedUrl ?? null;
}
