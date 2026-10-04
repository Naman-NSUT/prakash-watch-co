import Link from "next/link";
import { buildHref, type FilterState } from "@/lib/filters";

/**
 * Moving between pages of results.
 *
 * Plain links, not a button that fetches: the page number lives in the URL, so
 * a shopper can send someone "page 4 of the Casio divers", the back button does
 * what it should, and search engines can reach every watch. Nothing here needs
 * JavaScript.
 *
 * The window of numbers stays small — first, last, and a few either side of
 * where you are — because thirty-five page links is navigation nobody reads.
 */
export default function Pager({
  state,
  page,
  pages,
  base,
}: {
  state: FilterState;
  page: number;
  pages: number;
  base?: string;
}) {
  if (pages <= 1) return null;

  const near = new Set<number>([1, pages, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => near.add(n));
  if (page >= pages - 2) [pages - 3, pages - 2, pages - 1].forEach((n) => near.add(n));

  const numbers = [...near].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);

  return (
    <nav className="pager" aria-label="Pages of results">
      {page > 1 ? (
        <Link href={buildHref({ ...state, page: page - 1 }, base)} className="pager-step" rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className="pager-step is-off">← Previous</span>
      )}

      <span className="pager-numbers">
        {numbers.map((number, index) => (
          <span key={number} style={{ display: "contents" }}>
            {index > 0 && numbers[index - 1] !== number - 1 && <span className="pager-gap">…</span>}
            {number === page ? (
              <span className="pager-no is-here" aria-current="page">
                {number}
              </span>
            ) : (
              <Link href={buildHref({ ...state, page: number }, base)} className="pager-no">
                {number}
              </Link>
            )}
          </span>
        ))}
      </span>

      {page < pages ? (
        <Link href={buildHref({ ...state, page: page + 1 }, base)} className="pager-step" rel="next">
          Next →
        </Link>
      ) : (
        <span className="pager-step is-off">Next →</span>
      )}
    </nav>
  );
}
