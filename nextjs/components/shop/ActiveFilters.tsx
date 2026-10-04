import Link from "next/link";
import { GROUP_BY_KEY, buildHref, toggledHref, type FilterState } from "@/lib/filters";
import { formatInr } from "@/agent/format";

/** The chips above the grid: what is currently narrowing the results, each removable. */
export default function ActiveFilters({ state, base }: { state: FilterState; base?: string }) {
  const chips: Array<{ label: string; href: string }> = [];

  for (const [key, values] of Object.entries(state.selected)) {
    const group = GROUP_BY_KEY.get(key);
    if (!group) continue;
    for (const value of values) {
      chips.push({ label: `${group.label}: ${group.label_for(value)}`, href: toggledHref(state, key, value, base) });
    }
  }

  if (state.inStock) chips.push({ label: "In stock", href: buildHref({ ...state, inStock: false, page: 1 }, base) });
  if (state.onSale) chips.push({ label: "Reduced", href: buildHref({ ...state, onSale: false, page: 1 }, base) });
  if (state.min !== null || state.max !== null) {
    const low = state.min !== null ? formatInr(state.min) : "any";
    const high = state.max !== null ? formatInr(state.max) : "any";
    chips.push({ label: `${low} – ${high}`, href: buildHref({ ...state, min: null, max: null, page: 1 }, base) });
  }
  if (state.q) chips.push({ label: `“${state.q}”`, href: buildHref({ ...state, q: "", page: 1 }, base) });

  if (!chips.length) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
      {chips.map((chip) => (
        <Link
          key={chip.label}
          href={chip.href}
          scroll={false}
          data-hover
          className="mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "7px 11px",
            border: "1px solid var(--border)",
            borderRadius: 999,
            fontSize: 9.5,
            letterSpacing: "0.12em",
            color: "var(--body)",
            textTransform: "uppercase",
          }}
        >
          {chip.label}
          <span aria-hidden style={{ color: "var(--faint)", fontSize: 12, lineHeight: 1 }}>
            ×
          </span>
        </Link>
      ))}
    </div>
  );
}
