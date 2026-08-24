"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { COLLECTION_META, COLLECTIONS } from "@/agent/config";
import type { WatchProduct } from "@/agent/types";

/** Local formatter — keeps the node-only helpers in agent/util out of the browser bundle. */
function inr(amount: number): string {
  return `₹${new Intl.NumberFormat("en-IN").format(Math.round(amount))}`;
}

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  background: "var(--panel)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 300,
  outline: "none",
};

export default function ReviewForm({ product }: { product: WatchProduct }) {
  const router = useRouter();

  const [title, setTitle] = useState(product.title);
  const [modelName, setModelName] = useState(product.modelName ?? "");
  const [collection, setCollection] = useState(product.collection ?? "");
  const [gender, setGender] = useState(product.gender ?? "");
  const [selling, setSelling] = useState(String(product.price.selling));
  const [mrp, setMrp] = useState(product.price.mrp ? String(product.price.mrp) : "");
  const [quantity, setQuantity] = useState(product.quantity === null ? "" : String(product.quantity));
  const [inStock, setInStock] = useState(product.inStock);
  const [tagline, setTagline] = useState(product.copy.tagline);
  const [short, setShort] = useState(product.copy.short);
  const [long, setLong] = useState(product.copy.long);
  const [images, setImages] = useState(product.images);

  const [busy, setBusy] = useState<null | "save" | "publish" | "unpublish" | "delete">(null);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  function patchBody(status?: "ready" | "needs_review") {
    const sellingValue = Number(selling);
    const mrpValue = mrp.trim() ? Number(mrp) : null;

    return {
      ...(status ? { status } : {}),
      title: title.trim(),
      modelName: modelName.trim() || null,
      collection: collection ? collection : null,
      gender: gender ? gender : null,
      inStock,
      quantity: quantity.trim() ? Number(quantity) : null,
      price: { selling: sellingValue, mrp: mrpValue },
      copy: { tagline, short, long },
      imageOrder: images.map((image) => image.url),
    };
  }

  async function save(status?: "ready" | "needs_review", action: "save" | "publish" | "unpublish" = "save") {
    if (Number(selling) <= 0 || !Number.isFinite(Number(selling))) {
      setMessage({ text: "Enter a valid selling price.", bad: true });
      return;
    }

    setBusy(action);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/products/${product.sku}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patchBody(status)),
      });
      const body = (await response.json()) as { error?: string; details?: string[] };

      if (!response.ok) {
        setMessage({ text: body.details?.join(" ") ?? body.error ?? "Could not save.", bad: true });
      } else {
        setMessage({
          text: status === "ready" ? "Published to the shop." : status === "needs_review" ? "Taken off the shop." : "Saved.",
          bad: false,
        });
        router.refresh();
      }
    } catch {
      setMessage({ text: "The server did not respond.", bad: true });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${product.title} and its images? This cannot be undone.`)) return;

    setBusy("delete");
    try {
      const response = await fetch(`/api/admin/products/${product.sku}`, { method: "DELETE" });
      if (response.ok) router.push("/admin");
      else setMessage({ text: "Could not delete.", bad: true });
    } catch {
      setMessage({ text: "The server did not respond.", bad: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 30 }}>
      {/* Images */}
      <section>
        <span className="kicker">Photographs — first is the shop front image</span>
        {images.length === 0 ? (
          <p style={{ fontSize: 13.5, fontWeight: 300, color: "var(--muted)", marginTop: 14 }}>
            None kept. Add your own photographs to the sheet's Image URLs column and run this row again with “redo”.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 16 }}>
            {images.map((image, index) => (
              <div key={image.url} style={{ width: 132 }}>
                <div
                  style={{
                    position: "relative",
                    width: 132,
                    height: 132,
                    background: "#100e0d",
                    border: `1px solid ${index === 0 ? "var(--accent)" : "var(--line)"}`,
                  }}
                >
                  <Image src={image.url} alt={image.alt} fill sizes="132px" style={{ objectFit: "contain", padding: 8 }} />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  {index !== 0 && (
                    <MiniButton
                      onClick={() =>
                        setImages((previous) => [previous[index], ...previous.filter((_, i) => i !== index)])
                      }
                    >
                      Make first
                    </MiniButton>
                  )}
                  <MiniButton onClick={() => setImages((previous) => previous.filter((_, i) => i !== index))}>
                    Remove
                  </MiniButton>
                </div>
                <div className="mono" style={{ fontSize: 8.5, color: "var(--faint)", marginTop: 5, letterSpacing: "0.08em" }}>
                  {image.kind.toUpperCase()} · MATCH {(image.matchScore * 100).toFixed(0)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Details */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 18 }}>
        <Field label="Display title">
          <input value={title} onChange={(event) => setTitle(event.target.value)} style={fieldStyle} />
        </Field>
        <Field label="Model name">
          <input value={modelName} onChange={(event) => setModelName(event.target.value)} style={fieldStyle} />
        </Field>
        <Field label="Collection">
          <select value={collection} onChange={(event) => setCollection(event.target.value)} style={fieldStyle}>
            <option value="">— unassigned —</option>
            {COLLECTIONS.map((id) => (
              <option key={id} value={id}>
                {COLLECTION_META[id].name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Worn by">
          <select value={gender} onChange={(event) => setGender(event.target.value)} style={fieldStyle}>
            <option value="">— unspecified —</option>
            <option value="men">Men</option>
            <option value="women">Women</option>
            <option value="unisex">Unisex</option>
          </select>
        </Field>
        <Field label={`Selling price — ${inr(Number(selling) || 0)}`}>
          <input type="number" value={selling} onChange={(event) => setSelling(event.target.value)} style={fieldStyle} />
        </Field>
        <Field label="MRP (optional)">
          <input type="number" value={mrp} onChange={(event) => setMrp(event.target.value)} style={fieldStyle} />
        </Field>
        <Field label="Quantity">
          <input type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} style={fieldStyle} />
        </Field>
        <Field label="Availability">
          <label
            className="mono"
            style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 10, letterSpacing: "0.14em", color: "var(--body)", textTransform: "uppercase", paddingTop: 11 }}
          >
            <input type="checkbox" checked={inStock} onChange={(event) => setInStock(event.target.checked)} style={{ accentColor: "#c98a5e", width: 14, height: 14 }} />
            In stock
          </label>
        </Field>
      </section>

      {/* Copy */}
      <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Field label="Tagline — shown on the collection card">
          <input value={tagline} onChange={(event) => setTagline(event.target.value)} style={fieldStyle} />
        </Field>
        <Field label="Short description">
          <textarea value={short} rows={2} onChange={(event) => setShort(event.target.value)} style={{ ...fieldStyle, resize: "vertical" }} />
        </Field>
        <Field label="Full description">
          <textarea value={long} rows={7} onChange={(event) => setLong(event.target.value)} style={{ ...fieldStyle, resize: "vertical", lineHeight: 1.7 }} />
        </Field>
      </section>

      {message && (
        <p className="mono" style={{ margin: 0, fontSize: 11, letterSpacing: "0.08em", color: message.bad ? "#e0857a" : "var(--accent)" }}>
          {message.text}
        </p>
      )}

      <section style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--line)", paddingTop: 22 }}>
        <button type="button" onClick={() => save()} disabled={busy !== null} data-hover className="btn btn-ghost" style={{ cursor: "pointer" }}>
          {busy === "save" ? "Saving…" : "Save changes"}
        </button>

        {product.status === "ready" ? (
          <button type="button" onClick={() => save("needs_review", "unpublish")} disabled={busy !== null} data-hover className="btn btn-ghost" style={{ cursor: "pointer" }}>
            {busy === "unpublish" ? "…" : "Take off the shop"}
          </button>
        ) : (
          <button type="button" onClick={() => save("ready", "publish")} disabled={busy !== null} data-hover className="btn btn-solid" style={{ border: "none", cursor: "pointer" }}>
            {busy === "publish" ? "…" : "Approve and publish"}
          </button>
        )}

        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          data-hover
          className="mono"
          style={{
            marginLeft: "auto",
            background: "transparent",
            border: "1px solid var(--line)",
            color: "var(--dim)",
            padding: "12px 16px",
            fontSize: 9.5,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          {busy === "delete" ? "…" : "Delete"}
        </button>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <span className="kicker">{label}</span>
      {children}
    </label>
  );
}

function MiniButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-hover
      className="mono"
      style={{
        flex: 1,
        background: "transparent",
        border: "1px solid var(--line)",
        color: "var(--dim)",
        padding: "5px 4px",
        fontSize: 8,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
