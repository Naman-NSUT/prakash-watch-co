import Link from "next/link";
import { liveBanners } from "@/lib/banners";

/**
 * The shop's own notices, drifting under the houses.
 *
 * Whatever the shop wants seen this month: a festival scheme, a new arrival,
 * the workshop. Written from the stock room, so putting one up is a thing that
 * happens on a Tuesday rather than a deploy.
 *
 * It moves on its own, like the strip of houses above it, and stops on hover
 * so a banner can actually be read and clicked — a thing that slides away as
 * you reach for it is worse than one that never moved.
 */
export default async function BannerStrip() {
  const banners = await liveBanners();
  if (banners.length === 0) return null;

  // Two runs, so the second is in place as the first leaves. With only one or
  // two banners the track would be shorter than the screen, so it is repeated
  // until there is enough to cover the gap.
  const repeats = Math.max(2, Math.ceil(4 / banners.length) * 2);

  const card = (banner: (typeof banners)[number], key: string, hidden: boolean) => {
    const inner = (
      <>
        {/* The shop's own upload, already sized by the server. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={banner.image} alt={hidden ? "" : banner.alt} loading="lazy" />
        {(banner.heading || banner.caption) && (
          <span className="banner-words">
            {banner.heading && <strong className="serif">{banner.heading}</strong>}
            {banner.caption && <span>{banner.caption}</span>}
          </span>
        )}
      </>
    );

    return banner.href ? (
      <Link key={key} href={banner.href} className="banner-card" aria-hidden={hidden} tabIndex={hidden ? -1 : undefined}>
        {inner}
      </Link>
    ) : (
      <span key={key} className="banner-card" aria-hidden={hidden}>
        {inner}
      </span>
    );
  };

  return (
    <section className="banners" aria-label="From the shop">
      <div className="banners-track" style={{ animationDuration: `${Math.max(28, banners.length * 14)}s` }}>
        {Array.from({ length: repeats }, (_, run) =>
          banners.map((banner) => card(banner, `${run}-${banner.id}`, run > 0)),
        )}
      </div>
    </section>
  );
}
