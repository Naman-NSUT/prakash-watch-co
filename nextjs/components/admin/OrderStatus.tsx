"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Where an order has got to, changed from the stock room as it moves. */
const STAGES = ["approved", "packed", "shipped", "delivered"] as const;

export default function OrderStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currentIndex = Math.max(0, STAGES.indexOf(status as (typeof STAGES)[number]));
  const choices = STAGES.slice(currentIndex);

  async function change(next: string) {
    const was = value;
    setValue(next);
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The status could not be changed.");
      router.refresh();
    } catch (reason) {
      setValue(was);
      setError(reason instanceof Error ? reason.message : "The status could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 5 }}>
      <select
        className="ops-field"
        value={value}
        disabled={busy}
        onChange={(event) => change(event.target.value)}
        style={{ padding: "5px 7px", fontSize: 11, width: 118 }}
        aria-label="Order status"
      >
        {choices.map((stage) => (
          <option key={stage} value={stage}>{stage[0].toUpperCase() + stage.slice(1)}</option>
        ))}
      </select>
      {error && <span className="ops-error" role="alert" style={{ margin: 0, maxWidth: 180, fontSize: 10 }}>{error}</span>}
    </span>
  );
}
