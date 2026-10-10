"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The search box on the front page.
 *
 * Most people arrive knowing roughly what they want — a brand, a reference off
 * a caseback, "diver" — and the alternative was reading the navigation, opening
 * the collection and finding the search box there. Three steps to do the thing
 * they came to do.
 *
 * It searches nothing itself. It hands the words to the collection, which
 * already filters, sorts, paginates and can be linked to, so there is one
 * search in the shop rather than two that drift apart.
 */
export default function HomeSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const query = value.trim();
    router.push(query ? `/collections?q=${encodeURIComponent(query)}` : "/collections");
  }

  return (
    <form className="home-search" onSubmit={submit} role="search">
      <label htmlFor="home-search-field" className="sr-only">
        Search the collection
      </label>

      <svg
        className="home-search-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.6-3.6" />
      </svg>

      <input
        id="home-search-field"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search a brand, model or reference…"
        autoComplete="off"
        // A phone keyboard that says "search" rather than "return".
        enterKeyHint="search"
      />

      <button type="submit" className="home-search-go">
        Search
      </button>
    </form>
  );
}
