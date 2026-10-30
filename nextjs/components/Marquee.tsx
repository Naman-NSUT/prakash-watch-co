import { getBrands } from "@/lib/brands";

/**
 * The houses, drifting past under the hero.
 *
 * Logos rather than names. A wordmark set in the site's own serif is the
 * shop's handwriting, not the brand's — and these are marks people recognise
 * at a glance without reading, which is the whole point of a strip that never
 * stops moving.
 *
 * It takes the brands from the catalogue, so the strip is always what is
 * actually stocked: a house appears when its first reference is published and
 * leaves when the last one goes. Only those with a logo file are shown, since
 * a gap in a line of marks reads as a mistake.
 */
export default async function Marquee() {
  const brands = (await getBrands()).filter((brand) => brand.logo);
  if (brands.length === 0) return null;

  // Two identical runs, so the second is already in place as the first leaves.
  const strip = (key: string) => (
    <div className="marquee-strip" key={key} aria-hidden={key === "b"}>
      {brands.map((brand) => (
        <span className="marquee-mark" key={brand.slug}>
          {/* A plain img: these are the shop's own files, already small, and
              putting nineteen of them through the optimiser to draw them at
              one size buys nothing. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logo!} alt={key === "a" ? brand.name : ""} width="96" height="36" loading="lazy" />
        </span>
      ))}
    </div>
  );

  return (
    <section className="marquee" aria-label="Authorised brands">
      <div className="marquee-track">
        {strip("a")}
        {strip("b")}
      </div>
    </section>
  );
}
