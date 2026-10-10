"use client";

import { useRef, useState } from "react";
import type { Banner } from "@/lib/banners";

/**
 * The shop's own banners, written from the stock room.
 *
 * Each one is a picture and, if the shop wants them, a few words over it.
 * Order decides which drifts past first; switching one off keeps the wording
 * without showing it, so next Diwali is written by editing last Diwali rather
 * than from scratch.
 */
export default function BannerDesk({ initial }: { initial: Banner[] }) {
  const [banners, setBanners] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const newImage = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState({ heading: "", caption: "", href: "", alt: "" });

  async function send(body: FormData, id: string) {
    setBusy(id);
    setErrors([]);
    try {
      const response = await fetch("/api/admin/banners", { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) {
        setErrors(payload.errors ?? ["That did not work."]);
        return null;
      }
      return payload as Banner;
    } catch {
      setErrors(["Could not reach the shop's server."]);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function add() {
    const file = newImage.current?.files?.[0];
    if (!file) return setErrors(["Choose a picture first."]);
    const body = new FormData();
    body.set("image", file);
    body.set("heading", draft.heading);
    body.set("caption", draft.caption);
    body.set("href", draft.href);
    body.set("alt", draft.alt || draft.heading);
    body.set("order", String(banners.length));
    body.set("live", "true");

    const saved = await send(body, "new");
    if (!saved) return;
    setBanners([...banners, saved]);
    setDraft({ heading: "", caption: "", href: "", alt: "" });
    if (newImage.current) newImage.current.value = "";
  }

  async function patch(banner: Banner, changes: Partial<Banner>) {
    const body = new FormData();
    body.set("id", banner.id);
    for (const [key, value] of Object.entries(changes)) body.set(key, String(value));
    const saved = await send(body, banner.id);
    if (saved) setBanners(banners.map((b) => (b.id === banner.id ? saved : b)));
  }

  async function remove(banner: Banner) {
    setBusy(banner.id);
    try {
      await fetch(`/api/admin/banners?id=${encodeURIComponent(banner.id)}`, { method: "DELETE" });
      setBanners(banners.filter((b) => b.id !== banner.id));
    } finally {
      setBusy(null);
    }
  }

  const live = banners.filter((b) => b.live).length;

  return (
    <div className="ops-desk">
      {errors.length > 0 && (
        <div className="ops-alert" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      )}

      <section className="ops-card">
        <h2 className="serif">Put one up</h2>
        <p className="ops-note">
          A wide photograph — it is cropped to 1600 × 600, so send the largest you have. Words are optional: a good
          picture often reads better without them. {live} of {banners.length} showing on the front page.
        </p>

        <div className="ops-row">
          <input ref={newImage} type="file" accept="image/*" />
        </div>
        <div className="ops-row">
          <input className="ops-field" placeholder="Heading (optional)" value={draft.heading}
            onChange={(e) => setDraft({ ...draft, heading: e.target.value })} />
          <input className="ops-field" placeholder="A line under it (optional)" value={draft.caption}
            onChange={(e) => setDraft({ ...draft, caption: e.target.value })} />
        </div>
        <div className="ops-row">
          <input className="ops-field" placeholder="Where it goes — /offers, /brands/seiko (optional)"
            value={draft.href} onChange={(e) => setDraft({ ...draft, href: e.target.value })} />
          <input className="ops-field" placeholder="What the picture shows, for screen readers"
            value={draft.alt} onChange={(e) => setDraft({ ...draft, alt: e.target.value })} />
        </div>
        <div className="ops-row">
          <button type="button" className="ops-btn" data-variant="solid" disabled={busy !== null} onClick={add}>
            {busy === "new" ? "Saving…" : "Add banner"}
          </button>
        </div>
      </section>

      {banners.length === 0 ? (
        <p className="ops-foot-note">Nothing up yet. The strip stays hidden until there is something on it.</p>
      ) : (
        banners.map((banner, index) => (
          <section className="ops-card" key={banner.id}>
            <div className="ops-banner-row">
              <div className="ops-banner-shot">
                {/* The shop's own upload, already sized by the server. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={banner.image} alt={banner.alt} />
              </div>

              <div className="ops-banner-fields">
                <div className="ops-row" style={{ marginTop: 0 }}>
                  <input className="ops-field" defaultValue={banner.heading} placeholder="Heading"
                    onBlur={(e) => e.target.value !== banner.heading && patch(banner, { heading: e.target.value })} />
                  <input className="ops-field" defaultValue={banner.caption} placeholder="A line under it"
                    onBlur={(e) => e.target.value !== banner.caption && patch(banner, { caption: e.target.value })} />
                </div>
                <div className="ops-row">
                  <input className="ops-field" defaultValue={banner.href} placeholder="Where it goes"
                    onBlur={(e) => e.target.value !== banner.href && patch(banner, { href: e.target.value })} />
                  <label className="ops-inline">
                    <span className="mono">Order</span>
                    <input className="ops-field" type="number" style={{ width: 80 }} defaultValue={banner.order}
                      onBlur={(e) => Number(e.target.value) !== banner.order && patch(banner, { order: Number(e.target.value) })} />
                  </label>
                </div>
                <div className="ops-row">
                  <button type="button" className="ops-btn" disabled={busy === banner.id}
                    onClick={() => patch(banner, { live: !banner.live })}>
                    {banner.live ? "Showing — switch off" : "Hidden — show it"}
                  </button>
                  <button type="button" className="ops-btn" disabled={busy === banner.id}
                    onClick={() => remove(banner)}>
                    Delete
                  </button>
                  <span className="mono" style={{ fontSize: 9.5, color: "var(--faint)" }}>
                    {index + 1} of {banners.length}
                  </span>
                </div>
              </div>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
