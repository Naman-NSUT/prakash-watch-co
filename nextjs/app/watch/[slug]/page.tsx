import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AddToBag from "@/components/shop/AddToBag";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import Gallery from "@/components/Gallery";
import CatalogCard from "@/components/CatalogCard";
import { getProduct, getCatalogIndex, getBackdrops, COLLECTION_META } from "@/lib/catalog";
import { formatInr } from "@/agent/format";
import { brandSlug, getBrand } from "@/lib/brands";
import { backdropVisual } from "@/lib/backdrop-light";

// Render each listing on demand, then keep the finished page at Vercel's edge
// for the same short window as its product data. A cold Render service should
// never make a repeat visitor wait just to open a watch they already saw in the
// catalogue.
export const revalidate = 300;
export const dynamic = "force-static";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return { title: "Not found — Prakash Watch Co." };

  return {
    title: product.copy.seoTitle || `${product.title} — Prakash Watch Co.`,
    description: product.copy.seoDescription || product.copy.short,
    openGraph: {
      title: product.copy.seoTitle || product.title,
      description: product.copy.seoDescription || product.copy.short,
      images: product.images[0] ? [{ url: product.images[0].url }] : undefined,
    },
  };
}

export default async function WatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);

  // Unreviewed listings are not public; they live in the admin panel until approved.
  if (!product || product.status !== "ready") notFound();

  // Whether this watch may be bought from the website at all.
  //
  // The house decides for its range, and the shop sets that in the stock room;
  // off unless it has said otherwise. One watch may overrule its house in
  // either direction — a single piece a brand would rather be seen in person,
  // or one reference the shop is happy to ship from a house that otherwise is
  // not — and null, which is what every listing says unless somebody changed
  // it, means "follow the house".
  const house = await getBrand(brandSlug(product.brand));
  const sellsOnline = product.directSale ?? house?.directSale ?? false;

  const backdrops = await getBackdrops();
  const backdrop = backdropVisual(product.backdropId ? backdrops.get(product.backdropId) : undefined);

  const related = (await getCatalogIndex())
    .filter((entry) => entry.status === "ready" && entry.sku !== product.sku && entry.collection === product.collection)
    .slice(0, 3);

  const enquirySubject = encodeURIComponent(`Enquiry — ${product.title} (${product.modelNumber})`);
  const family = product.collection ? COLLECTION_META[product.collection] : null;

  return (
    <main style={{ position: "relative", minHeight: "100vh", background: "var(--bg)", overflow: "hidden" }}>
      <div className="grain" />
      <NavBar />

      <div style={{ padding: "var(--page-top) var(--gutter) 0" }}>
        <Link href="/collections" className="mono" style={{ fontSize: 10.5, letterSpacing: "0.2em", color: "var(--faint)", textTransform: "uppercase" }}>
          ← Collection
        </Link>
      </div>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "var(--cols-watch)",
          gap: 62,
          padding: "38px var(--gutter) 110px",
          alignItems: "start",
        }}
      >
        <div style={{ position: "sticky", top: 120 }}>
          <Gallery
            // Stripped to the fields the gallery draws: the rest of an image
            // record names the page the photograph was found on.
            images={product.images.map((image) => ({
              url: image.url,
              width: image.width,
              height: image.height,
              alt: image.alt,
              blurDataURL: image.blurDataURL,
              hasAlpha: image.hasAlpha,
            }))}
            title={product.title}
            backdrop={backdrop}
          />
        </div>

        <div>
          <span className="kicker">{product.brand}</span>
          <h1
            className="h2"
            style={{ fontSize: "clamp(34px, 4.2vw, 66px)", marginTop: 14 }}
          >
            {product.modelName ?? product.modelNumber}
          </h1>

          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 22, flexWrap: "wrap" }}>
            <span style={{ fontSize: 26 }}>
              {product.price.selling === null ? "Price on request" : formatInr(product.price.selling)}
            </span>
            {product.price.mrp ? (
              <span className="mono" style={{ fontSize: 13, color: "var(--faint)", textDecoration: "line-through" }}>
                {formatInr(product.price.mrp)}
              </span>
            ) : null}
            {product.price.discountPct ? (
              <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.18em", color: "var(--accent)" }}>
                −{product.price.discountPct}%
              </span>
            ) : null}
            <span
              className="mono"
              style={{ fontSize: 10.5, letterSpacing: "0.18em", color: product.inStock ? "var(--accent)" : "var(--dim)" }}
            >
              {product.inStock ? "IN STOCK" : "SOLD OUT"}
            </span>
          </div>

          <p style={{ margin: "26px 0 0", fontSize: 16.5, lineHeight: 1.75, fontWeight: 300, color: "var(--body)" }}>
            {product.copy.short}
          </p>

          {product.copy.bullets.length > 0 && (
            <ul style={{ margin: "26px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 11 }}>
              {product.copy.bullets.map((bullet) => (
                <li key={bullet} style={{ display: "flex", gap: 13, fontSize: 14.5, fontWeight: 300, color: "var(--muted)" }}>
                  <span style={{ color: "var(--accent)" }} aria-hidden>—</span>
                  {bullet}
                </li>
              ))}
            </ul>
          )}

          {/* A watch that is not in the case cannot be reserved or tried on, and
              offering it is how a shop loses an afternoon. It is still worth
              asking about — the same reference often comes back in — so the
              invitation changes rather than disappearing. */}
          <div style={{ display: "flex", gap: 13, marginTop: 38, flexWrap: "wrap" }}>
            {product.inStock && sellsOnline ? (
              <AddToBag
                item={{
                  sku: product.sku,
                  slug: product.slug,
                  title: product.title,
                  brand: product.brand,
                  image: product.images[0]?.url ?? "",
                  price: product.price.selling ?? 0,
                }}
              />
            ) : (
              <>
                <a
                  href={`https://wa.me/919899645897?text=${encodeURIComponent(
                    `Hello — is the ${product.brand} ${product.modelNumber} available? I saw it on your website.`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-solid"
                >
                  Contact the store
                </a>
                <a href="tel:+919899645897" className="btn btn-ghost">
                  Call the boutique
                </a>
              </>
            )}
          </div>

          {!product.inStock ? (
            <p style={{ margin: "16px 0 0", maxWidth: 460, fontSize: 13.5, lineHeight: 1.7, fontWeight: 300, color: "var(--muted)" }}>
              Not in the case at the moment. Message us and we will tell you when this reference is back, or show you
              what is in the safe that is close to it.
            </p>
          ) : !sellsOnline ? (
            <p style={{ margin: "16px 0 0", maxWidth: 460, fontSize: 13.5, lineHeight: 1.7, fontWeight: 300, color: "var(--muted)" }}>
              {product.brand} is sold at the counter rather than online. Message us and we will hold it, send more
              photographs, or show you what else has come in.
            </p>
          ) : null}

          {/* The spec sheet, sectioned the way a brand's own product page reads,
              with every line still traceable to the source it was quoted from. */}
          {product.specs.length > 0 && (
            <div style={{ marginTop: 58 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span className="kicker">Specification</span>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.16em", color: "var(--faint)" }}>
                  {product.specs.length} CONFIRMED
                </span>
              </div>

              {Object.entries(
                product.specs.reduce<Record<string, typeof product.specs>>((sections, spec) => {
                  (sections[spec.group] ??= []).push(spec);
                  return sections;
                }, {}),
              ).map(([section, specs]) => (
                <div key={section} style={{ marginTop: 26 }}>
                  <h2
                    className="serif"
                    style={{ margin: "0 0 2px", fontSize: 21, fontWeight: 400, color: "var(--text)" }}
                  >
                    {section}
                  </h2>
                  <dl style={{ margin: 0, borderTop: "1px solid var(--line)" }}>
                    {specs.map((spec) => {
                      // Where a figure came from is the shop's working note, not the
                      // customer's business: they get the reference number and the
                      // shop's word for it.
                      return (
                        <div
                          key={`${spec.label}-${spec.value}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "160px 1fr",
                            gap: 18,
                            alignItems: "baseline",
                            padding: "13px 4px",
                            borderBottom: "1px solid var(--line)",
                          }}
                        >
                          <dt
                            className="mono"
                            style={{ fontSize: 10, letterSpacing: "0.16em", color: "var(--faint)", textTransform: "uppercase" }}
                          >
                            {spec.label}
                          </dt>
                          <dd style={{ margin: 0, fontSize: 14.5, fontWeight: 300, color: "var(--body)" }}>
                            {spec.value}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ))}
            </div>
          )}

          {product.copy.long && (
            <div style={{ marginTop: 50 }}>
              <span className="kicker">In the hand</span>
              {product.copy.long.split(/\n\s*\n/).map((paragraph) => (
                <p key={paragraph.slice(0, 40)} style={{ margin: "18px 0 0", fontSize: 15.5, lineHeight: 1.8, fontWeight: 300, color: "var(--muted)" }}>
                  {paragraph}
                </p>
              ))}
            </div>
          )}

          <p className="mono" style={{ marginTop: 46, fontSize: 10, lineHeight: 1.9, letterSpacing: "0.1em", color: "var(--faint)", textTransform: "uppercase" }}>
            Reference {product.modelNumber}
            {family ? ` · ${family.name}` : ""}
            {product.gender ? ` · ${product.gender}` : ""}
            <br />
            Specifications checked in store. Confirm before purchase.
          </p>
        </div>
      </section>

      {related.length > 0 && (
        <section style={{ padding: "0 var(--gutter) 130px" }}>
          <h2 className="kicker" style={{ margin: 0 }}>Also in {family?.name ?? "the collection"}</h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
              gap: 22,
              marginTop: 28,
            }}
          >
            {related.map((entry) => (
              <CatalogCard
                key={entry.sku}
                entry={entry}
                backdrop={backdropVisual(entry.backdropId ? backdrops.get(entry.backdropId) : undefined)}
              />
            ))}
          </div>
        </section>
      )}

      <Footer />
    </main>
  );
}
