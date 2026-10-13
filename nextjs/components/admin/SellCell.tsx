"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Whether one watch may be bought on the site.
 *
 * Three states, not two, because "follow the house" is a real answer and the
 * common one: a brand is set to sell or not to sell in the brands desk, and
 * almost every watch should simply do what its house does. The override is for
 * the exceptions — a single piece that ought to be tried on, or one reference
 * the shop will ship from a house that otherwise asks for a visit.
 *
 * The brand's own setting is shown as the default so the shop can see what
 * "house" currently means without leaving the page.
 */
export default function SellCell({
  sku,
  value,
  house,
}: {
  sku: string;
  /** null follows the house. */
  value: boolean | null;
  /** What the house does, for the label on the default. */
  house: boolean;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<"house" | "sell" | "ask">(
    value === null ? "house" : value ? "sell" : "ask",
  );
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  async function change(next: "house" | "sell" | "ask") {
    const was = choice;
    setChoice(next);
    setState("saving");
    try {
      const response = await fetch(`/api/admin/products/${sku}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ directSale: next === "house" ? null : next === "sell" }),
      });
      if (!response.ok) throw new Error();
      setState("idle");
      router.refresh();
    } catch {
      setChoice(was);
      setState("error");
    }
  }

  return (
    <select
      className="ops-field"
      aria-label={`How ${sku} is sold`}
      value={choice}
      disabled={state === "saving"}
      onChange={(event) => change(event.target.value as "house" | "sell" | "ask")}
      style={{ padding: "5px 7px", fontSize: 11, width: 124, borderColor: state === "error" ? "var(--bad)" : undefined }}
    >
      <option value="house">House — {house ? "sells" : "ask in store"}</option>
      <option value="sell">Sell online</option>
      <option value="ask">Contact the store</option>
    </select>
  );
}
