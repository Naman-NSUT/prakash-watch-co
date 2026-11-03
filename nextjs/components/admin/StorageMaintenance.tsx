"use client";

import { useCallback, useEffect, useState } from "react";

interface StorageEntry {
  name: string;
  bytes: number;
}

interface StorageSnapshot {
  capacityBytes: number;
  freeBytes: number;
  usedBytes: number;
  entries: StorageEntry[];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index < 2 ? 0 : 1)} ${units[index]}`;
}

export default function StorageMaintenance() {
  const [storage, setStorage] = useState<StorageSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Reading the disk…");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/admin/storage", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "The storage report could not be read.");
    setStorage(body);
    setMessage("");
  }, []);

  useEffect(() => {
    refresh().catch((error) => setMessage(error instanceof Error ? error.message : "The disk could not be read."));
  }, [refresh]);

  const prune = async () => {
    setBusy(true);
    setMessage("Clearing reproducible agent cache files…");
    try {
      const response = await fetch("/api/admin/storage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prune-agent-cache" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The agent cache could not be cleared.");
      setStorage(body.storage);
      setMessage(`${formatBytes(body.removedBytes)} of reproducible cache files cleared.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The agent cache could not be cleared.");
    } finally {
      setBusy(false);
    }
  };

  const percent = storage?.capacityBytes
    ? Math.min(100, Math.round((storage.usedBytes / storage.capacityBytes) * 100))
    : 0;

  return (
    <>
      <section className="ops-cards" aria-label="Storage summary">
        <div className="ops-card">
          <div className="mono" style={{ fontSize: 9, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--faint)" }}>Disk used</div>
          <div className="mono" style={{ fontSize: 25, marginTop: 10 }}>{storage ? `${percent}%` : "—"}</div>
          <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 6 }}>
            {storage ? `${formatBytes(storage.usedBytes)} of ${formatBytes(storage.capacityBytes)}` : "Persistent shop disk"}
          </div>
        </div>
        <div className="ops-card">
          <div className="mono" style={{ fontSize: 9, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--faint)" }}>Free</div>
          <div className="mono" style={{ fontSize: 25, marginTop: 10, color: percent >= 90 ? "var(--bad)" : "var(--accent-soft)" }}>
            {storage ? formatBytes(storage.freeBytes) : "—"}
          </div>
          <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 6 }}>Available to listings, photos and bills</div>
        </div>
      </section>

      <section className="ops-panel" style={{ marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
          <div>
            <h2 className="serif" style={{ margin: 0, fontSize: 22, fontWeight: 400 }}>What is using the disk</h2>
            <p style={{ margin: "7px 0 0", maxWidth: 640, color: "var(--muted)", fontSize: 13 }}>
              The agent cache is safe to clear. It contains copies of source pages and model replies and is rebuilt when needed. Product records, customer orders, bills and saved photographs are never removed.
            </p>
          </div>
          <button type="button" className="ops-btn" data-variant="solid" disabled={busy || !storage} onClick={prune}>
            {busy ? "Clearing…" : "Clear agent cache"}
          </button>
        </div>

        {message && <p role="status" style={{ margin: "16px 0 0", color: "var(--accent-soft)", fontSize: 12 }}>{message}</p>}

        {storage && (
          <div className="ops-table-wrap" style={{ marginTop: 20 }}>
            <table className="ops-table">
              <thead><tr><th>Folder or file</th><th style={{ textAlign: "right" }}>Space</th></tr></thead>
              <tbody>
                {storage.entries.map((entry) => (
                  <tr key={entry.name}>
                    <td className="mono">{entry.name}</td>
                    <td className="ops-num">{formatBytes(entry.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
