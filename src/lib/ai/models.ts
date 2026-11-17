// Models allowed on AI Gateway's free tier, tried in order; on Vercel the gateway
// signs in with the project's OIDC token. Any failure (unparsable answer, ...) moves on
// to the next one. Claude models are left out: the free tier refuses them (403).
export const AI_MODELS = [
  "google/gemini-2.5-flash",
  "deepseek/deepseek-v4-flash",
];
