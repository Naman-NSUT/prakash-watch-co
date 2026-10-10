"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Finding one watch among 1,899.
 *
 * The catalogue is a hundred rows a page, which is fine for browsing and
 * useless when the shop has a reference in hand and needs to correct it. This
 * writes to the URL, so the filters and the page number keep working together
 * and a search can be left open in a tab.
 *
 * Typing is debounced and replaces rather than pushes, so a search leaves one
 * history entry rather than one per keystroke.
 */
export default function CatalogueSearch({ initial, total }: { initial: string; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) setValue(initial);
  }, [initial]);

  useEffect(() => {
    if (!typed.current) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      // A new search starts at the top; page 7 of the old results means nothing.
      next.delete("page");
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 260);
    return () => clearTimeout(timer);
  }, [value, params, pathname, router]);

  return (
    <div className="ops-search">
      <input
        type="search"
        className="ops-field"
        value={value}
        placeholder={`Reference, brand or name — ${total} listings`}
        aria-label="Search the catalogue"
        onChange={(event) => {
          typed.current = true;
          setValue(event.target.value);
        }}
      />
    </div>
  );
}
