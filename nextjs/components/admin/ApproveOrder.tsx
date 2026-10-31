"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Accept a paid order and commit its stock exactly once. */
export default function ApproveOrder({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function approve() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/orders/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The order could not be approved. Try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("The connection dropped. Try approving the order again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-order-approval">
      <button type="button" className="ops-btn" data-variant="solid" disabled={busy} onClick={approve}>
        {busy ? "Approving…" : "Approve order"}
      </button>
      <span className="mono">Stock moves when approved.</span>
      {error && <span className="ops-error" role="alert">{error}</span>}
    </div>
  );
}
