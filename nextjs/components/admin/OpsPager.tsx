import Link from "next/link";

/**
 * Pages of rows in the stock room.
 *
 * The catalogue and the inventory are 1,899 rows each, and rendering them all
 * cost several seconds a click. Everything stays reachable; it arrives a
 * hundred at a time, and the page number lives in the URL so the filters above
 * it keep working and a page can be linked to.
 */
export const OPS_PAGE_SIZE = 100;

export default function OpsPager({
  page,
  pages,
  total,
  href,
}: {
  page: number;
  pages: number;
  total: number;
  /** Builds the address of a page, keeping whatever filter is applied. */
  href: (page: number) => string;
}) {
  if (pages <= 1) return null;

  const from = (page - 1) * OPS_PAGE_SIZE + 1;
  const to = Math.min(page * OPS_PAGE_SIZE, total);

  return (
    <nav className="ops-pager" aria-label="Pages">
      <span className="mono ops-pager-count">
        {from}–{to} OF {total}
      </span>

      <span className="ops-pager-steps">
        {page > 1 ? (
          <Link href={href(page - 1)} className="ops-btn" rel="prev">
            ← Previous
          </Link>
        ) : (
          <span className="ops-btn" aria-disabled="true" style={{ opacity: 0.4 }}>
            ← Previous
          </span>
        )}
        <span className="mono ops-pager-of">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className="ops-btn" rel="next">
            Next →
          </Link>
        ) : (
          <span className="ops-btn" aria-disabled="true" style={{ opacity: 0.4 }}>
            Next →
          </span>
        )}
      </span>
    </nav>
  );
}
