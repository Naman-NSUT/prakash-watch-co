"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatInr } from "@/agent/format";

/**
 * Billing work done on the bench.
 *
 * A watch bill picks references out of stock; a repair bill cannot, because
 * what is being sold is labour. So the lines are typed: what was done and what
 * it costs. Nothing leaves inventory, and in the books the whole amount is the
 * shop's, since nothing was bought to sell.
 *
 * It is the same bill underneath — same numbering, same GST, same ledger — so
 * a day's takings is one figure whether it came off the shelf or the bench.
 */

export interface TicketForBilling {
  id: string;
  ref: string;
  customer: { name: string; phone: string; email: string; address: string };
  watch: string;
  kind: string;
  estimate: number | null;
}

interface Line {
  description: string;
  amount: string;
  quantity: number;
}

const GST_RATES = [0, 5, 12, 18];
const PAYMENTS = ["cash", "card", "upi", "bank", "other"] as const;

export default function RepairBillWriter({ tickets }: { tickets: TicketForBilling[] }) {
  const router = useRouter();
  const [ticketId, setTicketId] = useState("");
  const [customer, setCustomer] = useState({ name: "", phone: "", email: "", address: "" });
  const [lines, setLines] = useState<Line[]>([{ description: "", amount: "", quantity: 1 }]);
  const [gstRate, setGstRate] = useState(18);
  const [payment, setPayment] = useState<(typeof PAYMENTS)[number]>("cash");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const ticket = tickets.find((t) => t.id === ticketId) ?? null;

  /** Picking a docket fills in who it belongs to and what was quoted. */
  function chooseTicket(id: string) {
    setTicketId(id);
    const found = tickets.find((t) => t.id === id);
    if (!found) return;
    setCustomer(found.customer);
    setLines([
      {
        description: `${found.kind} — ${found.watch}`.slice(0, 160),
        amount: found.estimate ? String(found.estimate) : "",
        quantity: 1,
      },
    ]);
  }

  const amountOf = (line: Line) => {
    const value = Number(line.amount);
    return Number.isFinite(value) && value > 0 ? value * line.quantity : 0;
  };
  const taxable = lines.reduce((sum, line) => sum + amountOf(line), 0);
  const gstAmount = Math.round(((taxable * gstRate) / 100) * 100) / 100;
  const total = taxable + gstAmount;

  async function save() {
    setErrors([]);
    const usable = lines.filter((line) => line.description.trim() && amountOf(line) > 0);
    if (!customer.name.trim()) return setErrors(["Whose watch is it? The bill needs a name."]);
    if (!usable.length) return setErrors(["Add at least one line of work with an amount."]);

    setBusy(true);
    try {
      const response = await fetch("/api/admin/bills", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customer,
          gstRate,
          payment,
          note: ticket ? `${ticket.ref}${note ? ` · ${note}` : ""}` : note,
          lines: usable.map((line) => ({
            kind: "service",
            description: line.description.trim(),
            quantity: line.quantity,
            unitPrice: Number(line.amount),
            ticketRef: ticket?.ref ?? "",
          })),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setErrors(body.errors ?? ["The bill could not be written."]);
        return;
      }
      router.push(`/admin/billing/${body.id}`);
    } catch {
      setErrors(["Could not reach the shop's server."]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ops-desk">
      {errors.length > 0 && (
        <div className="ops-alert" role="alert">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      <section className="ops-card">
        <h2 className="serif">Which job</h2>
        <p className="ops-note">
          Pick the docket and the customer, the watch and the quote come with it. Or leave it blank and write the bill
          by hand — a battery changed over the counter never had a docket.
        </p>
        <div className="ops-row">
          <select className="ops-field" value={ticketId} onChange={(event) => chooseTicket(event.target.value)}>
            <option value="">No docket — billing it straight</option>
            {tickets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.ref.split("/").pop()} · {t.customer.name} · {t.watch}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="ops-card">
        <h2 className="serif">Customer</h2>
        <div className="ops-row">
          <input className="ops-field" placeholder="Name" value={customer.name}
            onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
          <input className="ops-field" placeholder="Phone" value={customer.phone}
            onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
          <input className="ops-field" placeholder="Email" value={customer.email}
            onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
        </div>
        <div className="ops-row">
          <input className="ops-field" style={{ flex: "1 1 100%" }} placeholder="Address (for the invoice)"
            value={customer.address} onChange={(e) => setCustomer({ ...customer, address: e.target.value })} />
        </div>
      </section>

      <section className="ops-card">
        <h2 className="serif">The work</h2>
        <p className="ops-note">
          One line per job: what was done and what it costs. Parts and labour can be separate lines if the customer
          should see the split.
        </p>

        <div className="ops-table-wrap" style={{ marginTop: 16 }}>
          <table className="ops-table">
            <thead>
              <tr>
                <th>What was done</th>
                <th style={{ width: 90 }}>Qty</th>
                <th style={{ width: 150 }}>Amount ₹</th>
                <th style={{ width: 120 }}>Line</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td>
                    <input className="ops-field" placeholder="Full overhaul, crystal replaced, new battery…"
                      value={line.description}
                      onChange={(e) => {
                        const next = [...lines];
                        next[index] = { ...line, description: e.target.value };
                        setLines(next);
                      }} />
                  </td>
                  <td>
                    <input className="ops-field" type="number" min={1} max={99} value={line.quantity}
                      onChange={(e) => {
                        const next = [...lines];
                        next[index] = { ...line, quantity: Math.max(1, Number(e.target.value) || 1) };
                        setLines(next);
                      }} />
                  </td>
                  <td>
                    <input className="ops-field" inputMode="decimal" placeholder="0" value={line.amount}
                      onChange={(e) => {
                        const next = [...lines];
                        next[index] = { ...line, amount: e.target.value.replace(/[^0-9.]/g, "") };
                        setLines(next);
                      }} />
                  </td>
                  <td className="mono">{amountOf(line) ? formatInr(amountOf(line)) : "—"}</td>
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="ops-btn"
                        onClick={() => setLines(lines.filter((_, i) => i !== index))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="ops-row">
          <button type="button" className="ops-btn"
            onClick={() => setLines([...lines, { description: "", amount: "", quantity: 1 }])}>
            Add a line
          </button>
        </div>
      </section>

      <section className="ops-card">
        <h2 className="serif">Settle it</h2>
        <div className="ops-row">
          <label className="ops-inline">
            <span className="mono">GST</span>
            <select className="ops-field" value={gstRate} onChange={(e) => setGstRate(Number(e.target.value))}>
              {GST_RATES.map((rate) => (
                <option key={rate} value={rate}>{rate}%</option>
              ))}
            </select>
          </label>
          <label className="ops-inline">
            <span className="mono">Paid by</span>
            <select className="ops-field" value={payment}
              onChange={(e) => setPayment(e.target.value as (typeof PAYMENTS)[number])}>
              {PAYMENTS.map((method) => (
                <option key={method} value={method}>{method}</option>
              ))}
            </select>
          </label>
          <input className="ops-field" placeholder="Note for the bill" value={note}
            onChange={(e) => setNote(e.target.value)} />
        </div>

        <dl className="ops-totals">
          <div><dt>Work</dt><dd className="mono">{formatInr(taxable)}</dd></div>
          <div><dt>GST at {gstRate}%</dt><dd className="mono">{formatInr(gstAmount)}</dd></div>
          <div className="ops-totals-due"><dt>Total</dt><dd className="mono">{formatInr(total)}</dd></div>
        </dl>

        <div className="ops-row">
          <button type="button" className="ops-btn" data-variant="solid" disabled={busy || total <= 0} onClick={save}>
            {busy ? "Writing…" : `Bill ${formatInr(total)}`}
          </button>
        </div>
      </section>
    </div>
  );
}
