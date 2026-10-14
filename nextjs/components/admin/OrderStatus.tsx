"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Where an order has got to, changed from the stock room as it moves. */
const STAGES = ["paid", "packed", "shipped", "delivered", "cancelled"] as const;

export default function OrderStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);

  async function change(next: string) {
    const was = value;
    setValue(next);
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!response.ok) throw new Error();
      router.refresh();
    } catch {
      setValue(was);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      className="ops-field"
      value={value}
      disabled={busy}
      onChange={(event) => change(event.target.value)}
      style={{ padding: "5px 7px", fontSize: 11, width: 118 }}
      aria-label="Order status"
    >
      {STAGES.map((stage) => (
        <option key={stage} value={stage}>{stage[0].toUpperCase() + stage.slice(1)}</option>
      ))}
    </select>
  );
}
