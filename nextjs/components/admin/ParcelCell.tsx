"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The parcel on one order.
 *
 * Before a waybill there are two ways to get one: take a number from the
 * courier's pool, or type the one already booked in Delhivery's own panel —
 * because the shop may well have booked it there, and two waybills for one
 * parcel is a parcel nobody can find.
 *
 * After that the number is the thing, with a button to ask the courier where
 * it has reached. The answer moves the order along by itself, so nobody has to
 * remember to mark it shipped.
 */
export default function ParcelCell({
  id,
  waybill,
  status,
}: {
  id: string;
  waybill: string;
  status: string;
}) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function book(existing?: string) {
    setBusy(true);
    setNote("");
    try {
      const response = await fetch(`/api/admin/orders/${id}/ship`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ waybill: existing ?? "" }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setNote(payload.error ?? "That did not work.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    setNote("");
    try {
      const response = await fetch(`/api/admin/orders/${id}/ship`);
      const payload = await response.json();
      setNote(response.ok ? payload.status || "No scan yet" : payload.error);
      if (response.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!waybill) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <button type="button" className="ops-btn" disabled={busy} onClick={() => book()} style={{ fontSize: 10, padding: "5px 9px" }}>
          {busy ? "…" : "Take a waybill"}
        </button>
        <span style={{ display: "flex", gap: 4 }}>
          <input
            className="ops-field"
            placeholder="or paste one"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            style={{ width: 104, padding: "4px 6px", fontSize: 10 }}
            aria-label="A waybill already booked with the courier"
          />
          <button type="button" className="ops-btn" disabled={busy || !typed.trim()} onClick={() => book(typed.trim())} style={{ fontSize: 10, padding: "4px 7px" }}>
            Use
          </button>
        </span>
        {note && <span className="mono" style={{ fontSize: 8.5, color: "var(--bad)" }}>{note}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <a
        className="mono"
        href={`https://www.delhivery.com/track/package/${encodeURIComponent(waybill)}`}
        target="_blank"
        rel="noreferrer"
        style={{ fontSize: 10.5, color: "var(--accent-soft)" }}
      >
        {waybill} ↗
      </a>
      <span className="mono" style={{ fontSize: 8.5, color: "var(--faint)" }}>{status || "not scanned yet"}</span>
      <button type="button" className="ops-btn" disabled={busy} onClick={check} style={{ fontSize: 9, padding: "3px 7px", alignSelf: "flex-start" }}>
        {busy ? "Asking…" : "Where is it?"}
      </button>
      {note && <span className="mono" style={{ fontSize: 8.5, color: "var(--dim)" }}>{note}</span>}
    </div>
  );
}
