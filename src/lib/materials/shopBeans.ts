// Coffee beans on the JWC online shop (www.justwantcoffee.com, a Shopify store), and how they
// line up with raw materials. Each shop size (variant) is one raw material, named like
// "JWC Single Origin Filter - Ethiopia Sidama Twakok G1 Washed 1kg".

export const SHOP_URL = "https://www.justwantcoffee.com";
export const SHOP_BRAND = "JWC Roastery";
// Sizes the Super Admin can tick on the sync page, in grams.
export const SHOP_SIZES = [100, 200, 500, 1000] as const;
// Price taken into the raw material: shop price less 20%.
const PRICE_FACTOR = 0.8;

type ShopVariant = { id: number; title: string; price: string; available: boolean };
export type ShopProduct = { id: number; title: string; tags: string[]; variants: ShopVariant[] };

type Kind = "blend" | "espresso" | "decaf" | "filter";
const PREFIX: Record<Kind, string> = {
  blend: "JWC Signature Blend",
  espresso: "JWC Single Origin Espresso",
  decaf: "JWC Decaf",
  filter: "JWC Single Origin Filter",
};

/** Every coffee bean product on the shop (tag "coffee-beans"). Throws when the shop cannot be read. */
export async function fetchShopBeans(): Promise<ShopProduct[]> {
  const products: ShopProduct[] = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`${SHOP_URL}/products.json?limit=250&page=${page}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`SHOP_${response.status}`);
    const body = (await response.json()) as { products?: ShopProduct[] };
    const list = body.products ?? [];
    products.push(...list);
    if (list.length < 250) break;
  }
  return products.filter((p) => p.tags.includes("coffee-beans"));
}

function kindOf(product: ShopProduct): Kind {
  if (product.tags.includes("signature-blend") || /^jwc signature blend\b/i.test(product.title)) return "blend";
  if (product.tags.includes("soe") || /^soe\s*-\s*/i.test(product.title)) return "espresso";
  if (product.tags.includes("decaf")) return "decaf";
  return "filter";
}

/** Shop title without "JWC Signature Blend:" or "SOE - " in front. */
function baseTitle(title: string) {
  return title
    .replace(/^jwc signature blend\s*[:\-]\s*/i, "")
    .replace(/^soe\s*-\s*/i, "")
    .trim();
}

/** "200g" → 200, "1kg" / "1000g" → 1000; null when the size is not in grams. */
export function gramsOf(text: string): number | null {
  const match = text.trim().match(/^(\d+(?:\.\d+)?)\s*(g|kg)$/i);
  if (!match) return null;
  const value = Number(match[1]) * (match[2].toLowerCase() === "kg" ? 1000 : 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function sizeLabel(grams: number) {
  return grams >= 1000 && grams % 1000 === 0 ? `${grams / 1000}kg` : `${grams}g`;
}

// Name parts compared without case, spaces, punctuation or a leading "The".
const loose = (text: string) =>
  text
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, "");

/** Kind, base name and size read back from a raw material name made with the pattern above. */
function parseMaterialName(name: string): { kind: Kind; base: string; grams: number | null } | null {
  for (const kind of Object.keys(PREFIX) as Kind[]) {
    const prefix = `${PREFIX[kind]} - `;
    if (name.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = name.slice(prefix.length).trim();
      const size = rest.match(/\s+(\d+(?:\.\d+)?\s*(?:g|kg))$/i);
      return {
        kind,
        base: size ? rest.slice(0, size.index).trim() : rest,
        grams: size ? gramsOf(size[1]) : null,
      };
    }
  }
  return null;
}

export type ExistingMaterial = {
  id: string;
  name: string;
  brand: string | null;
  shopVariantId: number | null;
  unavailable: boolean;
  // Size of its costing pack in grams, used when the name has no size.
  packGrams: number | null;
};

export type SyncRow = {
  variantId: number;
  name: string;
  grams: number;
  shopPrice: number;
  price: number;
  available: boolean;
  espresso: boolean;
  filter: boolean;
  // The raw material this size already is, if any.
  materialId: string | null;
  materialName: string | null;
  // Linked by name on this sync (not linked before).
  link: boolean;
  // Availability the sync will set on the existing material, when it changes.
  change: "unavailable" | "available" | null;
};

export type SyncPlan = {
  rows: SyncRow[];
  // Materials linked to a shop size that is no longer on the shop: set to Unavailable.
  gone: { id: string; name: string }[];
};

/** Lines each shop size up with a raw material; works the same in the preview and the sync. */
export function planShopSync(products: ShopProduct[], existing: ExistingMaterial[]): SyncPlan {
  const byVariant = new Map(existing.filter((m) => m.shopVariantId != null).map((m) => [m.shopVariantId!, m]));
  // Not yet linked: found by kind + name + size.
  const byKey = new Map<string, ExistingMaterial>();
  for (const m of existing) {
    if (m.shopVariantId != null) continue;
    const parsed = parseMaterialName(m.name);
    const grams = parsed?.grams ?? m.packGrams;
    if (!parsed || !grams) continue;
    const key = `${parsed.kind}|${loose(parsed.base)}|${grams}`;
    if (!byKey.has(key)) byKey.set(key, m);
  }

  const rows: SyncRow[] = [];
  const seen = new Set<number>();
  for (const product of products) {
    const kind = kindOf(product);
    const sizes = product.variants
      .map((variant) => ({ variant, grams: gramsOf(variant.title) }))
      .filter((s): s is { variant: ShopVariant; grams: number } => s.grams != null);
    const matches = sizes.map(({ variant, grams }) => {
      seen.add(variant.id);
      const linked = byVariant.get(variant.id);
      if (linked) return { material: linked, link: false };
      const found = byKey.get(`${kind}|${loose(baseTitle(product.title))}|${grams}`);
      if (found) {
        byKey.delete(`${kind}|${loose(baseTitle(product.title))}|${grams}`);
        return { material: found, link: true };
      }
      return { material: null, link: false };
    });
    // New sizes follow the name already used for this bean (e.g. "Pink Panther", not "The Pink Panther").
    const known = matches.map((m) => m.material && parseMaterialName(m.material.name)).find(Boolean);
    const base = known ? known.base : baseTitle(product.title);

    sizes.forEach(({ variant, grams }, i) => {
      const { material, link } = matches[i];
      const shopPrice = Number(variant.price);
      rows.push({
        variantId: variant.id,
        name: material ? material.name : `${PREFIX[kind]} - ${base} ${sizeLabel(grams)}`,
        grams,
        shopPrice,
        price: Math.round(shopPrice * PRICE_FACTOR * 100) / 100,
        available: variant.available,
        espresso: product.tags.includes("espresso-beans"),
        filter: product.tags.includes("filter-beans"),
        materialId: material?.id ?? null,
        materialName: material?.name ?? null,
        link,
        change: !material
          ? null
          : material.unavailable === !variant.available
            ? null
            : variant.available
              ? "available"
              : "unavailable",
      });
    });
  }

  const gone = existing
    .filter((m) => m.shopVariantId != null && !seen.has(m.shopVariantId) && !m.unavailable)
    .map((m) => ({ id: m.id, name: m.name }));
  return { rows, gone };
}
