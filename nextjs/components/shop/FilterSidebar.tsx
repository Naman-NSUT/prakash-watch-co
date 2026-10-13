import Link from "next/link";
import FilterShell from "./FilterShell";
import PriceFilter from "./PriceFilter";
import type { CatalogEntry } from "@/agent/types";
import {
  FILTER_GROUPS,
  activeCount,
  buildHref,
  facetOptions,
  toggledHref,
  type FilterState,
} from "@/lib/filters";

/**
 * The filter rail.
 *
 * Every option is an ordinary link carrying the next URL, so filtering works
 * before any JavaScript loads and each combination is a real, shareable address.
 * Counts are computed per group against the other filters, so a number always
 * answers "how many if I also picked this", never "how many are already showing".
 *
 * Where it sits is FilterShell's business: a rail beside the grid on a laptop,
 * a sheet over it on a phone.
 */
export default function FilterSidebar({
  entries,
  state,
  bounds,
  base,
  count,
}: {
  entries: CatalogEntry[];
  state: FilterState;
  bounds: { low: number; high: number };
  /** The page these filters belong to — the shop, or one brand's shelf. */
  base?: string;
  /** How many watches these filters leave, for the sheet's closing button. */
  count?: number;
}) {
  const active = activeCount(state);

  return (
    <FilterShell active={active} count={count}>
      <div className="shop-facets">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            paddingBottom: 14,
            borderBottom: "1px solid var(--line)",
          }}
        >
          <span className="kicker">Refine</span>
          {active > 0 && (
            <Link
              href={base ?? "/collections"}
              className="mono"
              style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--accent-soft)", textTransform: "uppercase" }}
            >
              Clear all
            </Link>
          )}
        </div>

        <Group label="Price" alwaysOpen>
          <PriceFilter min={state.min} max={state.max} bounds={bounds} />
        </Group>

        {/* Not held open: two tick boxes are worth less than the eleven headings
            they would push below the fold on a phone. It opens itself when
            something in it is on, like every other group. */}
        <Group label="Availability" chosen={(state.inStock ? 1 : 0) + (state.onSale ? 1 : 0)}>
          <Toggle
            href={buildHref({ ...state, inStock: !state.inStock, page: 1 }, base)}
            label="In stock only"
            selected={state.inStock}
          />
          <Toggle
            href={buildHref({ ...state, onSale: !state.onSale, page: 1 }, base)}
            label="Reduced"
            selected={state.onSale}
          />
        </Group>

        {FILTER_GROUPS.map((group) => {
          const options = facetOptions(entries, state, group);
          // A dimension nothing in the catalogue fills is not worth a heading.
          if (options.length < 2 && !options.some((option) => option.selected)) return null;

          return (
            <Group
              key={group.key}
              label={group.label}
              chosen={(state.selected[group.key] ?? []).length}
            >
              {options.map((option) => (
                <Link
                  key={option.value}
                  href={toggledHref(state, group.key, option.value, base)}
                  scroll={false}
                  className="facet-option"
                  data-selected={option.selected}
                  data-zero={option.count === 0}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <span className="facet-box" aria-hidden>
                      {option.selected && (
                        <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="var(--panel)" strokeWidth="2.4">
                          <path d="M2 6.5L4.8 9 10 3.5" />
                        </svg>
                      )}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {option.label}
                    </span>
                  </span>
                  <span className="mono" style={{ fontSize: 10, color: "var(--faint)" }}>
                    {option.count}
                  </span>
                </Link>
              ))}
            </Group>
          );
        })}
      </div>
    </FilterShell>
  );
}

/**
 * One dimension of the filter, closed until it is wanted.
 *
 * Ten groups open at once is a wall of two hundred checkboxes — on a phone the
 * first watch was a long scroll past Colour and Complications. The names stay
 * visible so the whole shape of the filter can be read at a glance; the options
 * arrive when one is asked for.
 *
 * A group with something chosen in it opens itself, because a filter you cannot
 * see you are using is a filter you cannot undo.
 */
function Group({
  label,
  children,
  chosen = 0,
  alwaysOpen = false,
}: {
  label: string;
  children: React.ReactNode;
  chosen?: number;
  alwaysOpen?: boolean;
}) {
  return (
    <details className="facet-group" open={alwaysOpen || chosen > 0}>
      <summary className="mono facet-group-head">
        <span>{label}</span>
        {chosen > 0 && <span className="facet-group-count">{chosen}</span>}
        <svg className="facet-group-caret" viewBox="0 0 12 12" width="9" height="9" fill="none"
          stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M3 4.5L6 7.5 9 4.5" />
        </svg>
      </summary>
      <div className="facet-group-body">{children}</div>
    </details>
  );
}

function Toggle({ href, label, selected }: { href: string; label: string; selected: boolean }) {
  return (
    <Link href={href} scroll={false} className="facet-option" data-selected={selected}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="facet-box" aria-hidden>
          {selected && (
            <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="var(--panel)" strokeWidth="2.4">
              <path d="M2 6.5L4.8 9 10 3.5" />
            </svg>
          )}
        </span>
        {label}
      </span>
    </Link>
  );
}
