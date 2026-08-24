"use client";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { AgentEvent } from "@/agent/events";
import type { RunReport } from "@/agent/types";

type StreamMessage = AgentEvent | { type: "report"; report: RunReport } | { type: "error"; message: string };

interface LogLine {
  id: number;
  text: string;
  tone: "plain" | "good" | "warn" | "bad" | "dim";
}

/** Renders one pipeline event as a line the shop staff can actually read. */
function describe(event: StreamMessage): { text: string; tone: LogLine["tone"] } | null {
  switch (event.type) {
    case "sheet:parsed":
      return {
        text: `Sheet read — ${event.rows} usable row(s)${event.rejected ? `, ${event.rejected} rejected` : ""}.`,
        tone: event.rejected ? "warn" : "plain",
      };
    case "run:models":
      return { text: `Using ${event.model}.`, tone: "dim" };
    case "row:start":
      return { text: `${event.label}`, tone: "plain" };
    case "row:stage":
      return { text: `   ${event.stage} — ${event.detail}`, tone: "dim" };
    case "row:warn":
      return { text: `   ! ${event.message}`, tone: "warn" };
    case "row:done":
      return {
        text: `   ${event.status === "ready" ? "✓ listed" : event.status === "skipped" ? "· skipped" : "~ needs review"} · ${event.images} image(s)`,
        tone: event.status === "ready" ? "good" : event.status === "skipped" ? "dim" : "warn",
      };
    case "row:fail":
      return { text: `   ✗ ${event.message}`, tone: "bad" };
    case "budget:exceeded":
      return { text: `Budget reached — remaining rows skipped.`, tone: "bad" };
    case "error":
      return { text: `Could not run: ${event.message}`, tone: "bad" };
    default:
      return null;
  }
}

export default function UploadPanel() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [force, setForce] = useState(false);
  const [limit, setLimit] = useState("");
  const [lines, setLines] = useState<LogLine[]>([]);
  const [report, setReport] = useState<RunReport | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const logRef = useRef<HTMLDivElement>(null);
  const lineId = useRef(0);

  const append = useCallback((text: string, tone: LogLine["tone"]) => {
    lineId.current += 1;
    setLines((previous) => [...previous.slice(-400), { id: lineId.current, text, tone }]);
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    });
  }, []);

  async function start() {
    if (!file || running) return;

    setRunning(true);
    setLines([]);
    setReport(null);
    setProgress({ done: 0, total: 0 });

    const form = new FormData();
    form.set("file", file);
    form.set("dryRun", String(dryRun));
    form.set("force", String(force));
    if (limit.trim()) form.set("limit", limit.trim());

    try {
      const response = await fetch("/api/admin/ingest", { method: "POST", body: form });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({ error: "The upload was rejected." }));
        append((body as { error?: string }).error ?? "The upload was rejected.", "bad");
        setRunning(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const payload = chunk.replace(/^data: /, "").trim();
          if (!payload) continue;

          let event: StreamMessage;
          try {
            event = JSON.parse(payload) as StreamMessage;
          } catch {
            continue;
          }

          if (event.type === "run:start") setProgress({ done: 0, total: event.rows });
          if (event.type === "row:done" || event.type === "row:fail") {
            setProgress((previous) => ({ ...previous, done: previous.done + 1 }));
          }
          if (event.type === "report") {
            setReport(event.report);
            continue;
          }

          const line = describe(event);
          if (line) append(line.text, line.tone);
        }
      }
    } catch (error) {
      append(`Connection lost: ${(error as Error).message}`, "bad");
    } finally {
      setRunning(false);
      router.refresh();
    }
  }

  const toneColour: Record<LogLine["tone"], string> = {
    plain: "var(--body)",
    good: "var(--accent)",
    warn: "#d8b98a",
    bad: "#e0857a",
    dim: "var(--faint)",
  };

  return (
    <section style={{ border: "1px solid var(--line)", background: "var(--card)" }}>
      <div style={{ padding: "26px 26px 0" }}>
        <h2 className="serif" style={{ fontSize: 28, margin: 0, fontWeight: 400 }}>
          Add stock from a sheet
        </h2>
        <p style={{ margin: "10px 0 22px", fontSize: 14, lineHeight: 1.65, fontWeight: 300, color: "var(--muted)", maxWidth: 620 }}>
          Upload the inventory list as .xlsx or .csv. It needs a brand column, a model number column and a price column —
          the names can be whatever the shop already uses. Everything else is researched and written for you, then held
          for review.
        </p>
      </div>

      {/* Drop zone */}
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files?.[0];
          if (dropped) setFile(dropped);
        }}
        style={{
          display: "block",
          margin: "0 26px",
          padding: "34px 24px",
          textAlign: "center",
          cursor: running ? "not-allowed" : "pointer",
          border: `1px dashed ${dragging ? "var(--accent)" : "var(--border)"}`,
          background: dragging ? "rgba(255,255,255,0.02)" : "transparent",
          transition: "border-color .3s, background-color .3s",
        }}
      >
        <input
          type="file"
          accept=".xlsx,.csv"
          disabled={running}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          style={{ display: "none" }}
        />
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", color: file ? "var(--text)" : "var(--dim)", textTransform: "uppercase" }}>
          {file ? file.name : "Drop the sheet here, or click to choose"}
        </span>
      </label>

      {/* Options */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "center", padding: "20px 26px" }}>
        <Toggle label="Dry run (no research, no spend)" checked={dryRun} onChange={setDryRun} disabled={running} />
        <Toggle label="Redo rows already listed" checked={force} onChange={setForce} disabled={running} />

        <label className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 9.5, letterSpacing: "0.14em", color: "var(--dim)", textTransform: "uppercase" }}>
          First
          <input
            type="number"
            min={1}
            value={limit}
            placeholder="all"
            disabled={running}
            onChange={(event) => setLimit(event.target.value)}
            style={{
              width: 66,
              padding: "7px 9px",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontFamily: "inherit",
              fontSize: 11,
            }}
          />
          rows
        </label>

        <button
          type="button"
          onClick={start}
          disabled={!file || running}
          data-hover
          className="btn btn-solid"
          style={{
            marginLeft: "auto",
            border: "none",
            cursor: !file || running ? "not-allowed" : "pointer",
            opacity: !file || running ? 0.45 : 1,
          }}
        >
          {running ? "Working…" : dryRun ? "Dry run" : "Research and list"}
        </button>
      </div>

      {(running || lines.length > 0) && (
        <div style={{ borderTop: "1px solid var(--line)" }}>
          {progress.total > 0 && (
            <div style={{ height: 2, background: "var(--line)", overflow: "hidden" }}>
              {/* Scaled rather than widened: a compositor-only transform, so the
                  bar cannot cause layout work while a run is streaming events. */}
              <div
                style={{
                  height: "100%",
                  width: "100%",
                  transformOrigin: "left",
                  transform: `scaleX(${Math.min(1, progress.done / progress.total)})`,
                  background: "var(--accent)",
                  transition: "transform .5s cubic-bezier(.2,.8,.2,1)",
                }}
              />
            </div>
          )}

          <div
            ref={logRef}
            className="mono"
            style={{
              maxHeight: 320,
              overflowY: "auto",
              padding: "18px 26px",
              fontSize: 11.5,
              lineHeight: 1.85,
              background: "var(--panel)",
              whiteSpace: "pre-wrap",
            }}
          >
            {lines.map((line) => (
              <div key={line.id} style={{ color: toneColour[line.tone] }}>
                {line.text}
              </div>
            ))}
            {running && <div style={{ color: "var(--faint)" }}>…</div>}
          </div>
        </div>
      )}

      {report && (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            padding: "20px 26px",
            display: "flex",
            gap: 26,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "var(--accent)" }}>
            {report.counts.ready} LISTED
          </span>
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "#d8b98a" }}>
            {report.counts.needsReview} NEED REVIEW
          </span>
          {report.counts.failed > 0 && (
            <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "#e0857a" }}>
              {report.counts.failed} FAILED
            </span>
          )}
          <span className="mono" style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "var(--faint)" }}>
            {report.counts.imagesSaved} IMAGES · ${report.costUsd.toFixed(3)}
          </span>
        </div>
      )}
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label
      className="mono"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        fontSize: 9.5,
        letterSpacing: "0.14em",
        color: checked ? "var(--body)" : "var(--dim)",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ accentColor: "#c98a5e", width: 14, height: 14 }}
      />
      {label}
    </label>
  );
}
