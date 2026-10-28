// Ingredient letters: the 1st ingredient is A, the 2nd B, … the 27th AA. Steps refer
// to ingredients as [A], [B]; the SOP shows the letter next to each ingredient.

const TOKEN = /\[([A-Z]{1,2})\]/g;

export function letterFor(index: number): string {
  const first = Math.floor(index / 26);
  const last = String.fromCharCode(65 + (index % 26));
  return first === 0 ? last : String.fromCharCode(64 + first) + last;
}

export function indexOfLetter(letter: string): number {
  if (letter.length === 1) return letter.charCodeAt(0) - 65;
  return (letter.charCodeAt(0) - 64) * 26 + (letter.charCodeAt(1) - 65);
}

/**
 * After ingredients are reordered or removed, rewrites [X] references in step text so
 * each still points at the same ingredient. A removed ingredient's reference becomes
 * its name.
 */
export function relabelSteps(
  instructions: string[],
  before: { key: string; name: string }[],
  after: { key: string }[],
): string[] {
  const newIndex = new Map(after.map((line, index) => [line.key, index]));
  return instructions.map((text) =>
    text.replace(TOKEN, (token, letter: string) => {
      const line = before[indexOfLetter(letter)];
      if (!line) return token;
      const index = newIndex.get(line.key);
      return index === undefined ? line.name : `[${letterFor(index)}]`;
    }),
  );
}

/** Splits step text into plain parts and ingredient references, for display. */
export function splitReferences(text: string, count: number): ({ text: string } | { letter: string })[] {
  const parts: ({ text: string } | { letter: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    if (indexOfLetter(match[1]) >= count) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ letter: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
