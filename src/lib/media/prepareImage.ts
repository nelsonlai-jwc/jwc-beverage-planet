// Photo rules (O14): JPEG, PNG or WebP up to 10 MB; HEIC/HEIF from iPhones is
// converted to JPEG in the browser before upload.
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export type PreparedImage = { ok: true; file: File } | { ok: false; error: "type" | "size" | "convert" };

function looksLikeHeic(file: File) {
  return /^image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  let result = file;
  if (looksLikeHeic(file)) {
    try {
      // Loaded only when needed: the converter is large.
      const { heicTo } = await import("heic-to/next");
      const blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
      result = new File([blob], file.name.replace(/\.hei[cf]$/i, "") + ".jpg", { type: "image/jpeg" });
    } catch {
      return { ok: false, error: "convert" };
    }
  }
  if (!PHOTO_TYPES.includes(result.type)) return { ok: false, error: "type" };
  if (result.size > MAX_PHOTO_BYTES) return { ok: false, error: "size" };
  return { ok: true, file: result };
}
