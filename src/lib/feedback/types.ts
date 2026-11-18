export const FEEDBACK_KINDS = ["BUG", "IDEA"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_STATUSES = ["NEW", "ACCEPTED", "REJECTED", "WITH_CLAUDE", "DONE"] as const;
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
  ACCEPTED: "purple",
  REJECTED: "red",
  WITH_CLAUDE: "orange",
  DONE: "green",
};

/** One-tap reasons for not taking a report up; the submitter reads them in their own language. */
export const REJECT_REASONS = {
  BUG: ["WORKS_AS_DESIGNED", "CANNOT_REPRODUCE", "ALREADY_FIXED", "NEED_DETAILS", "PERMISSION", "DEVICE_NETWORK", "DUPLICATE"],
  IDEA: ["ALREADY_EXISTS", "NOT_FIT_WORKFLOW", "NOT_PRIORITY", "COST_TOO_HIGH", "AFFECTS_OTHERS", "POLICY", "NEED_DETAILS", "DUPLICATE"],
} as const;
export const ALL_REJECT_REASONS = [...new Set([...REJECT_REASONS.BUG, ...REJECT_REASONS.IDEA])] as string[];
export const isRejectReason = (value: string) => ALL_REJECT_REASONS.includes(value);

export const FEEDBACK_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type FeedbackPriority = (typeof FEEDBACK_PRIORITIES)[number];
export const isPriority = (value: unknown): value is FeedbackPriority =>
  typeof value === "string" && (FEEDBACK_PRIORITIES as readonly string[]).includes(value);
export const priorityTone: Record<FeedbackPriority, "red" | "orange" | "grey"> = {
  HIGH: "red",
  MEDIUM: "orange",
  LOW: "grey",
};
export const MAX_NOTE = 2000;

/** Only an in-app path is kept as the page a report came from. */
export function safeFromPath(value: string | undefined | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value.slice(0, 500);
}
