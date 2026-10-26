"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useBag } from "./Cart";

/**
 * The bag, the address, and the payment, on one page.
 *
 * Three steps down a page rather than three pages, because a bag of one or two
 * watches does not need a wizard, and every extra page is somewhere to lose a
 * customer. The totals shown here come from the catalogue's own prices and are
 * settled again on the server before anything is charged; if the two disagree,
 * the server wins and says so.
 */
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const inr = (value: number) =>
  `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export default function Checkout() {
  const bag = useBag();
  const router = useRouter();
  const [form, setForm] = useState({
    name: "", phone: "", email: "",
    line1: "", line2: "", city: "", state: "", pincode: "",
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * Whether the courier reaches the PIN the customer has typed.
   *
   * Checked while they are still filling the form, because finding out after
   * the money has gone is the worst moment to learn it. An unknown answer is
   * never shown as a refusal — the shop would rather take the order and
   * arrange the delivery by telephone.
   */
  const [reach, setReach] = useState<{ deliverable: boolean; district?: string; state?: string } | null>(null);

  useEffect(() => {
    const pincode = form.pincode.trim();
    if (!/^\d{6}$/.test(pincode)) {
      setReach(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/checkout/serviceable?pincode=${pincode}`);
        const payload = await response.json();
        setReach(payload.known ? payload : null);
      } catch {
        setReach(null);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form.pincode]);

  // Razorpay's own script, loaded once and only on this page.
  //
  // Waited for rather than hoped for: it is fetched asynchronously, and a
  // customer who fills the form quickly could press Pay before it arrived and
  // be told to check a connection that was never the problem.
  const script = useRef<Promise<boolean> | null>(null);

  function loadRazorpay(): Promise<boolean> {
    if (window.Razorpay) return Promise.resolve(true);
    if (script.current) return script.current;
    script.current = new Promise<boolean>((resolve) => {
      const tag = document.createElement("script");
      tag.src = "https://checkout.razorpay.com/v1/checkout.js";
      tag.async = true;
      tag.onload = () => resolve(Boolean(window.Razorpay));
      tag.onerror = () => {
        script.current = null;
        resolve(false);
      };
      document.body.appendChild(tag);
    });
    return script.current;
  }

  useEffect(() => {
    void loadRazorpay();
    // Loaded once for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = bag.items.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const taxable = Math.round((total / 1.18) * 100) / 100;

  async function pay() {
    setErrors([]);
    setBusy(true);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lines: bag.items.map((line) => ({ sku: line.sku, quantity: line.quantity })),
          customer: { name: form.name, phone: form.phone, email: form.email },
          address: {
            line1: form.line1, line2: form.line2,
            city: form.city, state: form.state, pincode: form.pincode,
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setErrors(payload.errors ?? ["That did not work. Please try again."]);
        return;
      }
      if (!(await loadRazorpay())) {
        setErrors([
          "The payment window would not load. Your order is saved — telephone the boutique on +91 98996 45897 " +
            "with the number above and we will take the payment there.",
        ]);
        return;
      }

      const Razorpay = window.Razorpay;
      if (!Razorpay) {
        setErrors(["The payment window would not open. Please telephone the boutique and we will take the order."]);
        return;
      }

      const checkout = new Razorpay({
        key: payload.keyId,
        order_id: payload.razorpayOrderId,
        amount: payload.amountPaise,
        currency: "INR",
        name: "Prakash Watch Co.",
        description: payload.number,
        prefill: { name: form.name, contact: form.phone, email: form.email },
        theme: { color: "#7a5c1c" },
        handler: async (result: Record<string, string>) => {
          const confirmed = await fetch("/api/checkout/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(result),
          });
          const outcome = await confirmed.json();
          if (outcome.ok) {
            bag.clear();
            router.push(`/checkout/done?order=${encodeURIComponent(outcome.number)}`);
          } else {
            setErrors([outcome.error ?? "We could not confirm that payment. Please call the boutique before trying again."]);
          }
        },
      });
      checkout.open();
    } catch {
      setErrors(["We could not reach the shop. Please try again."]);
    } finally {
      setBusy(false);
    }
  }

  if (!bag.ready) return <p style={{ color: "var(--muted)" }}>Opening your bag…</p>;

  if (bag.items.length === 0) {
    return (
      <div style={{ padding: "40px 0" }}>
        <p style={{ fontSize: 16, fontWeight: 300, color: "var(--muted)", maxWidth: 460 }}>
          Your bag is empty. The collection is through here — or call the boutique and we will find the reference for you.
        </p>
        <div style={{ display: "flex", gap: 13, marginTop: 24, flexWrap: "wrap" }}>
          <Link href="/collections" className="btn btn-solid">Browse the collection</Link>
          <a href="tel:+919899645897" className="btn btn-ghost">Call the boutique</a>
        </div>
      </div>
    );
  }

  const field = (key: keyof typeof form, label: string, extra: Record<string, string> = {}) => (
    <label style={{ display: "block" }}>
      <span className="mono" style={{ display: "block", fontSize: 9.5, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--faint)", marginBottom: 6 }}>
        {label}
      </span>
      <input
        className="ops-field"
        value={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        style={{ width: "100%" }}
        {...extra}
      />
    </label>
  );

  return (
    <div className="checkout">
      <section>
        {bag.items.map((line) => (
          <article key={line.sku} className="checkout-line">
            <span className="checkout-shot">
              {line.image ? <img src={line.image} alt="" /> : null}
            </span>
            <div style={{ minWidth: 0 }}>
              <Link href={`/watch/${line.slug}`} className="serif" style={{ fontSize: 19, color: "var(--text)" }}>
                {line.title}
              </Link>
              <p className="mono" style={{ margin: "4px 0 0", fontSize: 9.5, letterSpacing: ".16em", color: "var(--faint)", textTransform: "uppercase" }}>
                {line.brand}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
                <button type="button" className="checkout-step" onClick={() => bag.setQuantity(line.sku, line.quantity - 1)} aria-label="One fewer">−</button>
                <span className="mono" style={{ fontSize: 13, minWidth: 18, textAlign: "center" }}>{line.quantity}</span>
                <button type="button" className="checkout-step" onClick={() => bag.setQuantity(line.sku, line.quantity + 1)} aria-label="One more">+</button>
                <button type="button" className="checkout-remove mono" onClick={() => bag.remove(line.sku)}>Remove</button>
              </div>
            </div>
            <span className="mono" style={{ fontSize: 15, whiteSpace: "nowrap" }}>{inr(line.price * line.quantity)}</span>
          </article>
        ))}

        <div className="checkout-form">
          <h2 className="serif" style={{ fontSize: 22, margin: "0 0 18px" }}>Where it should go</h2>
          <div className="checkout-grid">
            {field("name", "Name")}
            {field("phone", "Phone", { type: "tel", inputMode: "tel" })}
          </div>
          {field("email", "Email (for the invoice)", { type: "email" })}
          <div style={{ marginTop: 14 }}>{field("line1", "Address")}</div>
          <div style={{ marginTop: 14 }}>{field("line2", "Apartment, landmark (optional)")}</div>
          <div className="checkout-grid" style={{ marginTop: 14 }}>
            {field("city", "City")}
            {field("state", "State")}
            {field("pincode", "PIN code", { inputMode: "numeric" })}
          </div>
          {reach && (
            <p className={reach.deliverable ? "checkout-reach" : "checkout-reach checkout-reach-no"}>
              {reach.deliverable
                ? `Delivers to ${[reach.district, reach.state].filter(Boolean).join(", ")}.`
                : "Our courier does not reach this PIN code. Place the order anyway and we will telephone you to arrange it."}
            </p>
          )}
        </div>
      </section>

      <aside className="checkout-total">
        <h2 className="mono" style={{ fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--faint)", margin: "0 0 16px" }}>
          To pay
        </h2>
        <dl style={{ margin: 0 }}>
          <div className="checkout-row"><dt>Taxable value</dt><dd className="mono">{inr(taxable)}</dd></div>
          <div className="checkout-row"><dt>GST @ 18% (included)</dt><dd className="mono">{inr(total - taxable)}</dd></div>
          <div className="checkout-row"><dt>Delivery</dt><dd className="mono">Free</dd></div>
          <div className="checkout-row checkout-sum"><dt>Total</dt><dd className="mono">{inr(total)}</dd></div>
        </dl>
        <p style={{ margin: "14px 0 0", fontSize: 12, lineHeight: 1.6, fontWeight: 300, color: "var(--muted)" }}>
          Every price includes GST. Insured delivery across India, and the manufacturer's warranty starts the day it reaches you.
        </p>

        {errors.length > 0 && (
          <div className="checkout-errors" role="alert">
            {errors.map((error) => <p key={error}>{error}</p>)}
          </div>
        )}

        <button type="button" className="btn btn-solid" style={{ width: "100%", marginTop: 18, justifyContent: "center" }} disabled={busy} onClick={pay}>
          {busy ? "One moment…" : `Pay ${inr(total)}`}
        </button>
        <p className="mono" style={{ margin: "12px 0 0", fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--faint)", textAlign: "center" }}>
          Card · UPI · Net banking
        </p>
      </aside>
    </div>
  );
}
