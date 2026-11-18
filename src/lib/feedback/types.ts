export const FEEDBACK_KINDS = ["BUG", "IDEA"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ["NEW", "PLANNED", "IN_PROGRESS", "DONE", "WONT_DO"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_DEVICES = ["PHONE", "TABLET", "DESKTOP"] as const;
export type FeedbackDevice = (typeof FEEDBACK_DEVICES)[number];

export const FEEDBACK_BUCKET = "feedback-media";
export const MAX_FEEDBACK_PHOTOS = 5;
export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 4000;
export const MAX_REPLY = 2000;

export const isKind = (value: unknown): value is FeedbackKind =>
  typeof value === "string" && (FEEDBACK_KINDS as readonly string[]).includes(value);
export const isStatus = (value: unknown): value is FeedbackStatus =>
  typeof value === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(value);

/** Badge colour for each status (colour plus text, never colour alone). */
export const statusTone: Record<FeedbackStatus, "grey" | "purple" | "orange" | "green" | "red"> = {
  NEW: "grey",
  PLANNED: "purple",
  IN_PROGRESS: "orange",
  DONE: "green",
  WONT_DO: "red",
};

/** Only an in-app path is kept as the page a report came from. */
export function safeFromPath(value: string | undefined | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value.slice(0, 500);
}
