import Link from "next/link";
import UploadPanel from "@/components/admin/UploadPanel";
import RerunPanel from "@/components/admin/RerunPanel";
import { getCatalogIndex } from "@/lib/catalog";
import { Empty, PageHead, formatInr } from "@/components/admin/ui";
import OpsPager, { OPS_PAGE_SIZE } from "@/components/admin/OpsPager";
import CatalogueSearch from "@/components/admin/CatalogueSearch";
import SellCell from "@/components/admin/SellCell";
import { brandSlug, getBrands } from "@/lib/brands";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; flag?: string; page?: string; q?: string; sort?: string }>;
}) {
  const { status, flag, page: pageParam, q, sort } = await searchParams;
  // The index, not the artifacts. Opening all 1,900 of them to draw a hundred
  // rows cost 1.7 seconds a click; this file carries everything the table shows.
  const products = await getCatalogIndex();
  // What each house does, so a row can label its default without the shop
  // having to remember which brands it sells online.
  const houses = new Map((await getBrands()).map((house) => [house.slug, house.directSale]));

  // Reference, brand, name or sku — whatever the shop has in hand.
  const needle = (q ?? "").trim().toLowerCase();
  const matches = (product: (typeof products)[number]) =>
    !needle ||
    [product.modelNumber, product.brand, product.title, product.modelName, product.sku]
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(needle));

  const shown = products.filter(matches).filter((product) => {
    if (flag) return product.flags.includes(flag);
    if (status === "review") return product.status !== "ready";
    if (status === "live") return product.status === "ready";
    return true;
  });

  /**
   * How the list is ordered.
   *
   * The default still floats what needs a decision to the top, because that is
   * the work and a list sorted by name buries it. But a stock room also wants
   * to see what came in this morning, or what the dearest pieces are, and
   * neither question could be asked before.
   *
   * Newest reads the date the listing was written rather than when it was last
   * touched: an agent pass that re-renders a photograph should not make a watch
   * from March look like this morning's work. "Recently changed" is the other
   * question and has its own order.
   */
  const SORTS = {
    decisions: "What needs deciding",
    newest: "Most recent first",
    oldest: "Oldest first",
    touched: "Recently changed",
    dear: "Price, high to low",
    cheap: "Price, low to high",
    brand: "Brand A\u2013Z",
    thin: "Fewest photographs",
  } as const;
  type SortKey = keyof typeof SORTS;
  const order: SortKey = (sort && sort in SORTS ? sort : "decisions") as SortKey;

  const priceOf = (entry: (typeof shown)[number]) => entry.price.selling ?? 0;
  const when = (value: string) => (value ? Date.parse(value) || 0 : 0);

  const ordered = [...shown].sort((a, b) => {
    switch (order) {
      case "newest":
        return when(b.createdAt) - when(a.createdAt);
      case "oldest":
        return when(a.createdAt) - when(b.createdAt);
      case "touched":
        return when(b.updatedAt) - when(a.updatedAt);
      case "dear":
        return priceOf(b) - priceOf(a);
      case "cheap":
        return priceOf(a) - priceOf(b);
      case "brand":
        return a.brand.localeCompare(b.brand) || a.title.localeCompare(b.title);
      case "thin":
        return a.imageCount - b.imageCount || a.brand.localeCompare(b.brand);
      default:
        return (
          Number(a.status === "ready") - Number(b.status === "ready") ||
          a.brand.localeCompare(b.brand)
        );
    }
  });

  // A hundred at a time: rendering all 1,899 took several seconds a click.
  const pages = Math.max(1, Math.ceil(ordered.length / OPS_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(pageParam) || 1), pages);
  const shownPage = ordered.slice((page - 1) * OPS_PAGE_SIZE, page * OPS_PAGE_SIZE);

  const live = products.filter((p) => p.status === "ready").length;

  const pageHref = (next: number) => {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (flag) query.set("flag", flag);
    if (q) query.set("q", q);
    if (order !== "decisions") query.set("sort", order);
    if (next > 1) query.set("page", String(next));
    const search = query.toString();
    return search ? `/admin/catalogue?${search}` : "/admin/catalogue";
  };

  return (
    <>
      <PageHead
        title="Catalogue"
        lead={
          `${live.toLocaleString("en-IN")} of ${products.length.toLocaleString("en-IN")} listings are on the website. ` +
          `${(products.length - live).toLocaleString("en-IN")} are still waiting for you to approve them, and are shown first below.`
        }
      />

      {/* The question this page is opened to answer: what is up, and what is
          not. It was answerable before — the chips carried the counts — but the
          list itself opens on the review queue, so a hundred rows marked
          "Review" read as "nothing has been uploaded". Said plainly here
          instead, above everything else on the page. */}
      <div className="ops-split">
        <Link href="/admin/catalogue?status=live" className="ops-split-half" data-tone="good">
          <span className="ops-split-figure mono">{live.toLocaleString("en-IN")}</span>
          <span className="ops-split-label">On the website</span>
          <span className="ops-split-note">Customers can see and search these</span>
        </Link>
        <Link href="/admin/catalogue?status=review" className="ops-split-half" data-tone="warn">
          <span className="ops-split-figure mono">{(products.length - live).toLocaleString("en-IN")}</span>
          <span className="ops-split-label">Not uploaded yet</span>
          <span className="ops-split-note">Held until you approve each one</span>
        </Link>
      </div>

      <Suspense fallback={<div className="ops-search" />}>
        <CatalogueSearch initial={q ?? ""} total={products.length} />
      </Suspense>

      <UploadPanel />

      <section style={{ border: "1px solid var(--line)", background: "var(--card)", padding: 20, margin: "var(--ops-4) 0" }}>
        <span className="ops-sublabel" style={{ marginTop: 0 }}>Research the review queue again</span>
        <p style={{ fontSize: 12.5, lineHeight: 1.6, fontWeight: 300, color: "var(--dim)", margin: "0 0 14px", maxWidth: 640 }}>
          Puts every listing currently held for review back through the pipeline. Worth doing after the agent has
          been improved — a watch that failed on an old run often succeeds on the new one. Prices and quantities
          you have typed are kept.
        </p>
        <RerunPanel mode="bulk" scope="review" count={products.filter((p) => p.status !== "ready").length} />
      </section>

      <nav aria-label="Filter listings" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "20px 0 12px" }}>
        <Link href="/admin/catalogue" className="ops-chip" data-tone={!status && !flag ? "good" : "mute"}>All {products.length}</Link>
        <Link href="/admin/catalogue?status=review" className="ops-chip" data-tone={status === "review" ? "warn" : "mute"}>
          Not uploaded {products.length - live}
        </Link>
        <Link href="/admin/catalogue?status=live" className="ops-chip" data-tone={status === "live" ? "good" : "mute"}>On the website {live}</Link>
        <Link href="/admin/catalogue?flag=provisional-image" className="ops-chip" data-tone={flag === "provisional-image" ? "warn" : "mute"}>
          Unconfirmed photo {products.filter((p) => p.flags.includes("provisional-image")).length}
        </Link>
      </nav>

      <div className="ops-sorts" style={{ justifyContent: "space-between" }}>
        <span className="ops-note" style={{ margin: 0 }}>
          {ordered.length.toLocaleString("en-IN")} listing{ordered.length === 1 ? "" : "s"} shown
        </span>
        {/* Downloads what is on the screen, not the whole catalogue: a shop
            looking at the 264 held for review and getting all 1,900 would be a
            quietly wrong answer. */}
        <a
          className="ops-btn"
          href={`/api/admin/catalogue/export${(() => {
            const query = new URLSearchParams();
            if (status) query.set("status", status);
            if (flag) query.set("flag", flag);
            if (q) query.set("q", q);
            const search = query.toString();
            return search ? `?${search}` : "";
          })()}`}
          download
        >
          Download this list
        </a>
      </div>

      <nav aria-label="Order the list" className="ops-sorts">
        <span className="ops-sublabel" style={{ marginTop: 0 }}>Order</span>
        {(Object.keys(SORTS) as SortKey[]).map((key) => {
          const query = new URLSearchParams();
          if (status) query.set("status", status);
          if (flag) query.set("flag", flag);
          if (q) query.set("q", q);
          if (key !== "decisions") query.set("sort", key);
          const search = query.toString();
          return (
            <Link
              key={key}
              href={search ? `/admin/catalogue?${search}` : "/admin/catalogue"}
              className="ops-chip"
              data-tone={order === key ? "good" : "mute"}
            >
              {SORTS[key]}
            </Link>
          );
        })}
      </nav>

      {ordered.length === 0 ? (
        <Empty title="Nothing listed yet" body="Upload the shop's stock sheet above — brand, model number and price are all it needs." />
      ) : (
        <div className="ops-panel" style={{ padding: 0 }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th style={{ width: 44 }} />
                <th>Watch</th><th>Held for</th>
                <th style={{ textAlign: "right" }}>Price</th>
                <th style={{ textAlign: "right" }}>Photos</th>
                <th style={{ textAlign: "right" }}>Specs</th>
                <th style={{ textAlign: "right" }}>Confidence</th>
                <th>Sold</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shownPage.map((product) => (
                <tr key={product.sku}>
                  <td>
                    <span style={{ position: "relative", display: "block", width: 34, height: 34, background: "var(--well)", border: "1px solid var(--line)" }}>
                      {/* A 34px thumbnail does not need the image optimiser,
                          and asking for one generated 122KB of srcsets across a
                          hundred rows. */}
                      {product.image && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={product.image.url}
                          alt=""
                          loading="lazy"
                          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", padding: 2 }}
                        />
                      )}
                    </span>
                  </td>
                  <td>
                    <Link href={`/admin/review/${product.sku}`} style={{ color: "var(--text)" }}>{product.title}</Link>
                    <span className="mono" style={{ display: "block", fontSize: 9.5, color: "var(--faint)", marginTop: 2 }}>
                      {product.modelNumber.toUpperCase()}
                    </span>
                  </td>
                  <td>
                    <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {product.flags.slice(0, 2).map((f) => (
                        <span key={f} className="ops-chip" data-tone={f === "provisional-image" ? "warn" : "mute"} style={{ fontSize: 8 }}>
                          {f.replace(/-/g, " ")}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="ops-num">
                    {product.price.selling === null
                      ? <span style={{ color: "var(--faint)" }}>not priced</span>
                      : formatInr(product.price.selling)}
                  </td>
                  <td className="ops-num" style={{ color: product.imageCount ? "var(--body)" : "var(--bad)" }}>{product.imageCount}</td>
                  <td className="ops-num">{product.specCount}</td>
                  <td className="ops-num" style={{ color: product.confidence > 0.7 ? "var(--accent)" : "var(--dim)" }}>
                    {(product.confidence * 100).toFixed(0)}%
                  </td>
                  <td>
                    <SellCell
                      sku={product.sku}
                      value={product.directSale ?? null}
                      house={houses.get(brandSlug(product.brand)) ?? false}
                    />
                  </td>
                  <td>
                    {product.status === "ready"
                      ? <span className="ops-chip" data-tone="good">On the website</span>
                      : <span className="ops-chip" data-tone="warn">Not uploaded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <OpsPager page={page} pages={pages} total={ordered.length} href={pageHref} />
        </div>
      )}
    </>
  );
}
