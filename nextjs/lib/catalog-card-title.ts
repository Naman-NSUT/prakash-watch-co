import type { CatalogEntry } from "@/agent/types";

const ONLY_GENERIC_WORDS = /^(?:watch|wristwatch|product|model|men'?s?|women'?s?)(?:\s+(?:watch|wristwatch|product|model|men'?s?|women'?s?))*$/i;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove the brand and reference while retaining a real range or model name. */
function withoutIdentity(value: string | null | undefined, entry: CatalogEntry): string {
  let result = value?.trim() ?? "";
  for (const identity of [entry.brand, entry.modelNumber]) {
    if (!identity) continue;
    result = result.replace(
      new RegExp(`(^|[^a-z0-9])${escapeRegExp(identity)}(?=$|[^a-z0-9])`, "gi"),
      "$1",
    );
  }
  // Brand feeds sometimes decorate the same reference (NM1792WM01,
  // AR11500I). Remove that whole code token too; the exact reference remains
  // visible on the dedicated REF line.
  const reference = entry.modelNumber.toLowerCase().replace(/[^a-z0-9]/g, "");
  result = result.replace(/[a-z0-9][a-z0-9._/+\-]*/gi, (token) => {
    const normal = token.toLowerCase().replace(/[^a-z0-9]/g, "");
    return reference && normal.includes(reference) ? " " : token;
  });
  return result
    .replace(/\s+/g, " ")
    .replace(/\b(?:for|with|in|and)\s*$/i, "")
    .replace(/^[\s\-–—|:/,]+|[\s\-–—|:/,]+$/g, "");
}

function isUsefulName(value: string): boolean {
  return /[a-z]{2}/i.test(value) && !ONLY_GENERIC_WORDS.test(value);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (/^(?:gmt|gps|led)$/i.test(word)) return word.toUpperCase();
      return word
        .split("-")
        .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part))
        .join("-");
    })
    .join(" ");
}

function facetLabel(value: string | null | undefined): string {
  if (!value) return "";
  const normal = value
    .replace(/stainless[ -]?steel/gi, "steel")
    .replace(/rose[ -]?gold/gi, "rose-gold")
    .replace(/gold[ -]?tone/gi, "gold-tone")
    .replace(/mother[ -]?of[ -]?pearl/gi, "pearl")
    .replace(/_+/g, " ");
  return titleCase(normal);
}

function watchKind(entry: CatalogEntry): string {
  const functions = entry.facets.functions.map((value) => value.toLowerCase());
  if (functions.some((value) => value.includes("chronograph"))) return "Chronograph";
  if (functions.some((value) => /(^|\W)gmt($|\W)/.test(value))) return "GMT";
  if (functions.some((value) => value.includes("moon"))) return "Moonphase";

  const movement = entry.facets.movement?.toLowerCase() ?? "";
  if (movement.includes("automatic") || movement.includes("mechanical")) return "Automatic";
  if (entry.collection === "solar-eco" || movement.includes("solar")) return "Solar";
  if (entry.collection === "connected") return "Smart";
  if (entry.collection === "dive-sport") return "Sport";
  if (movement.includes("quartz") || entry.collection === "dress-quartz") return "Quartz";

  if (functions.some((value) => value.includes("day-date") || value.includes("day date"))) return "Day-Date";
  if (functions.some((value) => value === "date" || value.includes("date display"))) return "Date";
  return "";
}

function titleFromFacets(entry: CatalogEntry): string {
  const dial = facetLabel(entry.facets.dialColour);
  const kind = watchKind(entry);

  if (dial) {
    if (!kind) return `${dial} Dial Watch`;
    return `${dial} Dial ${kind}${kind === "Chronograph" ? "" : " Watch"}`;
  }

  const strap = facetLabel(entry.facets.strap);
  const material = facetLabel(entry.facets.caseMaterial);
  const descriptor = strap && strap !== "Bracelet" ? strap : material;
  if (descriptor && kind) return `${descriptor} ${kind} Watch`;
  if (descriptor) return `${descriptor} Classic Watch`;
  return "";
}

function titleFromTagline(tagline: string): string {
  const cleaned = tagline
    .replace(/stainless[ -]?steel/gi, "steel")
    .replace(/day and date/gi, "day-date")
    .replace(/two[ -]?toned?/gi, "two-tone")
    .replace(/[^a-z0-9+-]+/gi, " ")
    .trim();
  if (!cleaned) return "Classic Everyday Watch";

  const stop = new Set(["a", "an", "the", "with", "in", "on", "of", "for", "and", "to", "its"]);
  const words: string[] = [];
  for (const word of cleaned.split(/\s+/)) {
    if (stop.has(word.toLowerCase())) continue;
    words.push(word);
    if (word.toLowerCase() === "watch" && words.length >= 3) break;
    if (words.length === 4) break;
  }
  if (words.length < 2) words.push("Everyday", "Watch");
  else if (words.length === 2 && !words.some((word) => /^watch$/i.test(word))) words.push("Watch");
  return titleCase(words.join(" "));
}

/**
 * A shopper-facing card name. The reference remains on the REF line below it,
 * so a missing model name should never make the same code the card's headline.
 */
export function catalogCardTitle(entry: CatalogEntry): string {
  for (const candidate of [entry.modelName, entry.title]) {
    const name = withoutIdentity(candidate, entry);
    if (isUsefulName(name)) return name;
  }

  return titleFromFacets(entry) || titleFromTagline(entry.tagline);
}
