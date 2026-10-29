import { prepareImage, type PreparedImage } from "./prepareImage";

// Step media: a photo (same rules as prepareImage) or a video up to 50 MB,
// the Supabase free plan's per-file limit.
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const STEP_MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";

const VIDEO_EXTENSIONS: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

export type PreparedStepMedia = PreparedImage & { isVideo?: boolean };

export async function prepareStepMedia(file: File): Promise<PreparedStepMedia> {
  // Some browsers leave the type empty for .mov; fall back to the extension.
  const type = file.type || VIDEO_EXTENSIONS[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
  if (!type.startsWith("video/")) return prepareImage(file);
  if (!VIDEO_TYPES.includes(type)) return { ok: false, error: "type" };
  if (file.size > MAX_VIDEO_BYTES) return { ok: false, error: "size" };
  return { ok: true, file: type === file.type ? file : new File([file], file.name, { type }), isVideo: true };
}

export function extensionFor(type: string) {
  return type === "video/quicktime" ? "mov" : type.split("/")[1];
}
