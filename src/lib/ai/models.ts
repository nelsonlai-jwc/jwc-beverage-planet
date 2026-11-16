// Models allowed on AI Gateway's free tier, tried in order; on Vercel the gateway
// signs in with the project's OIDC token. Any failure (free tier refuses the model,
// unparsable answer, ...) moves on to the next one.
export const AI_MODELS = [
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.5-flash",
  "deepseek/deepseek-v4-flash",
];
