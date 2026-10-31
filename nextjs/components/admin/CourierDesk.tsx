"use client";

import { useState } from "react";

/**
 * The courier's particulars, set by the shop.
 *
 * The pickup location has to match what Delhivery One holds exactly, and a
 * manifest with the wrong one is refused — so it is a thing to try, correct
 * and try again, which is not what a deploy is for.
 *
 * The token is write-only here. It goes in and is never shown again; the panel
 * says only whether one is set and its last four characters, so the shop can
 * tell which key is in there without the key being readable off a screen in a
 * shop.
 */
export interface CourierView {
  pickupName: string;
  pickupPhone: string;
  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupPincode: string;
  tokenSet: boolean;
  tokenTail: string;
}

export default function CourierDesk({ initial }: { initial: CourierView }) {
  const [view, setView] = useState(initial);
  const [token, setToken] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [note, setNote] = useState("");

  async function save() {
    setState("saving");
    setNote("");
    try {
      const response = await fetch("/api/admin/courier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...view, token }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setNote(payload.errors?.[0] ?? "That did not save.");
        setState("error");
        return;
      }
      setView(payload);
      setToken("");
      setState("saved");
      window.setTimeout(() => setState("idle"), 2400);
    } catch {
      setNote("Could not reach the shop's server.");
      setState("error");
    }
  }

  async function test() {
    const pincode = view.pickupPincode.trim();
    if (!/^\d{6}$/.test(pincode)) {
      setNote("Enter the six-digit pickup PIN code before testing.");
      return;
    }
    setState("saving");
    setNote("Saving the settings…");
    try {
      // Testing an unsaved token used to ask Delhivery with the previous saved
      // settings and then report the PIN as unsupported. Persist the exact form
      // being tested first so the result always describes what is on screen.
      const saveResponse = await fetch("/api/admin/courier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...view, token }),
      });
      const saved = await saveResponse.json();
      if (!saveResponse.ok) {
        setNote(saved.errors?.[0] ?? "Those settings did not save.");
        setState("error");
        return;
      }
      setView(saved);
      setToken("");
      setNote("Asking the courier…");

      const response = await fetch(`/api/checkout/serviceable?pincode=${pincode}`);
      const payload = await response.json();
      if (!payload.known) {
        setNote(
          saved.tokenSet
            ? "Delhivery did not return a serviceability answer. Check the saved token and try again."
            : "No Delhivery token is saved. Paste the token, save the settings, then test again.",
        );
        setState("error");
        return;
      }
      setNote(
        payload.deliverable
          ? `Working — the courier answers for ${[payload.district, payload.state].filter(Boolean).join(", ")}.`
          : "The courier answered, but does not serve that PIN code.",
      );
      setState("saved");
      window.setTimeout(() => setState("idle"), 2400);
    } catch {
      setNote("Could not save or reach Delhivery. Check the token and try again.");
      setState("error");
    }
  }

  const field = (label: string, key: keyof CourierView, hint?: string) => (
    <label style={{ display: "block", marginTop: 12 }}>
      <span className="ops-sublabel" style={{ marginTop: 0 }}>{label}</span>
      <input
        className="ops-field"
        value={String(view[key] ?? "")}
        onChange={(event) => setView({ ...view, [key]: event.target.value })}
        style={{ width: "100%" }}
      />
      {hint && <span className="ops-note" style={{ display: "block", marginTop: 4 }}>{hint}</span>}
    </label>
  );

  return (
    <details className="ops-card" style={{ marginBottom: "var(--ops-4)" }}>
      <summary className="serif" style={{ cursor: "pointer", fontSize: 18 }}>
        The courier {view.tokenSet ? `— set up (…${view.tokenTail})` : "— not set up yet"}
      </summary>

      <p className="ops-note" style={{ marginTop: 10 }}>
        Delhivery. The pickup location must be spelled exactly as it is registered in Delhivery One, or a manifest is
        refused. Everything here stays on the shop&apos;s own server.
      </p>

      <label style={{ display: "block", marginTop: 12 }}>
        <span className="ops-sublabel" style={{ marginTop: 0 }}>API token</span>
        <input
          className="ops-field"
          type="password"
          value={token}
          placeholder={view.tokenSet ? `kept — ends ${view.tokenTail}` : "paste the token"}
          onChange={(event) => setToken(event.target.value)}
          style={{ width: "100%" }}
          autoComplete="off"
        />
        <span className="ops-note" style={{ display: "block", marginTop: 4 }}>
          Leave blank to keep the one already saved.
        </span>
      </label>

      {field("Pickup location name", "pickupName", "As registered with Delhivery — not the shop's trading name unless they match.")}
      {field("Pickup phone", "pickupPhone")}
      {field("Pickup address", "pickupAddress")}
      <div className="ops-row">
        {field("City", "pickupCity")}
        {field("State", "pickupState")}
        {field("PIN code", "pickupPincode")}
      </div>

      <div className="ops-row" style={{ marginTop: 16 }}>
        <button type="button" className="ops-btn" data-variant="solid" disabled={state === "saving"} onClick={save}>
          {state === "saving" ? "Saving…" : state === "saved" ? "Saved ✓" : "Save"}
        </button>
        <button type="button" className="ops-btn" disabled={state === "saving"} onClick={test}>Save &amp; test connection</button>
        {note && <span className="ops-note" style={{ margin: 0 }}>{note}</span>}
      </div>
    </details>
  );
}
