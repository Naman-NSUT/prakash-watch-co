/**
 * Linen counterparts for the photographic backdrops.
 *
 * A cut-out watch is published on transparency and the card supplies the stage
 * behind it. The six stages the agent matches against are all near-black —
 * they were made for the copper theme, and a black square inside a linen-white
 * card looks like a hole punched in the page.
 *
 * So each one gets a pale twin here, in code rather than in `backdrops.json`:
 * the catalogue's copy of that file lives on the back end's disk and is only
 * seeded once, so a new field in the repository's copy would never reach a
 * shop that has already been running. Hue and intent are carried across — the
 * cool ones stay cool, the warm ones stay warm — so a watch the agent paired
 * with Bronze for its blue dial still sits on something warm.
 *
 * Only the wash changes: the photographs the library names were never
 * generated, so a wash is all a stage has ever been.
 */

const WASH: Record<string, string> = {
  // Deepest of the dark set, for bright steel and white dials. Its opposite is
  // the warmest paper, so steel keeps an edge against it.
  ink: "radial-gradient(120% 100% at 50% 42%, #fbf8f3 0%, #e7e0d4 72%)",
  // Cool near-black, for gold and warm dials. Stays cool: gold needs the
  // contrast or it goes muddy.
  graphite: "radial-gradient(120% 100% at 50% 42%, #f4f6f9 0%, #dde2e9 72%)",
  // Warm amber, chosen to flatter blue dials without competing.
  bronze: "radial-gradient(120% 100% at 50% 42%, #fdf4e7 0%, #eedfc7 72%)",
  slate: "radial-gradient(120% 100% at 50% 42%, #f3f5f9 0%, #dbe1ea 72%)",
  stone: "radial-gradient(120% 100% at 50% 42%, #f9f5ed 0%, #e5ddcf 72%)",
  clay: "radial-gradient(120% 100% at 50% 42%, #fdf3ec 0%, #ecd9cb 72%)",
};

/** A neutral paper wash, for a stage this file has not been taught yet. */
const FALLBACK = "radial-gradient(120% 100% at 50% 42%, #faf7f2 0%, #e6e0d6 72%)";

export function lightWash(backdropId: string | null | undefined): string {
  if (!backdropId) return FALLBACK;
  return WASH[backdropId] ?? FALLBACK;
}
