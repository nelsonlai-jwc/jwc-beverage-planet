// Remembers the last filters, sort and name search of each recipe list tab for this browser tab
// (sessionStorage), so coming back to the list after opening or editing a recipe keeps them.

export const LIST_KEYS = ["q", "outlet", "status", "type", "purpose", "style", "temp", "sort", "dir"] as const;

const storageKey = (tab: string) => `recipes-list:${tab}`;

// Saves the non-empty filters in the current URL for its tab (nothing set = forget).
export function rememberRecipeList() {
  try {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") || "mine";
    const kept = new URLSearchParams();
    for (const key of LIST_KEYS) {
      const value = params.get(key);
      if (value) kept.set(key, value);
    }
    const value = kept.toString();
    if (value) sessionStorage.setItem(storageKey(tab), value);
    else sessionStorage.removeItem(storageKey(tab));
  } catch {
    // Storage blocked: the list simply opens without remembered filters.
  }
}

export function recalledRecipeList(tab: string) {
  try {
    return sessionStorage.getItem(storageKey(tab)) ?? "";
  } catch {
    return "";
  }
}
