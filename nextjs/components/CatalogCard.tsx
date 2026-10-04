import Image from "next/image";
import Link from "next/link";
import type { Backdrop, CatalogEntry } from "@/agent/types";
import { formatInr } from "@/agent/format";
import { lightWash } from "@/lib/backdrop-light";

/** One watch in the collections grid, in the house style. */
export default function CatalogCard({ entry, backdrop }: { entry: CatalogEntry; backdrop?: Backdrop }) {
  // A cut-out watch is published on transparency, so the card supplies the
  // backdrop the agent matched to its colour. An uncut photograph brings its own.
  //
  // The stage is the CSS wash alone. The library also names a photograph per
  // backdrop, but nothing has ever generated those files — every card has been
  // requesting one and getting a 400 back. The wash is what has always been on
  // screen, so it is now the whole of it.
  const usesBackdrop = Boolean(backdrop && entry.image?.hasAlpha);

  return (
    <Link
      href={`/watch/${entry.slug}`}
      className="hover-card"
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--card)",
        border: "1px solid var(--line)",
        textDecoration: "none",
      }}
    >
      <div
        className={usesBackdrop ? "card-stage" : undefined}
        style={{
          position: "relative",
          aspectRatio: "1 / 1",
          background: "var(--well)",
          // The pale twin, used by the light themes. See lib/backdrop-light.ts.
          ...(usesBackdrop ? { ["--stage-light" as string]: lightWash(backdrop!.id) } : {}),
          // The CSS wash renders instantly; the generated image layers over it.
          backgroundImage: usesBackdrop
            ? backdrop!.css
            : entry.image
              ? undefined
              : "repeating-linear-gradient(135deg, var(--card-hover) 0 2px, var(--well) 2px 9px)",
          borderBottom: "1px solid var(--line)",
          overflow: "hidden",
        }}
      >

        {entry.image ? (
          <Image
            src={entry.image.url}
            alt={entry.image.alt}
            fill
            sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 33vw"
            placeholder={entry.image.blurDataURL ? "blur" : "empty"}
            blurDataURL={entry.image.blurDataURL ?? undefined}
            style={{ objectFit: "contain", padding: 18 }}
          />
        ) : (
          <span
            className="mono"
            style={{
              position: "absolute",
              left: 18,
              bottom: 18,
              fontSize: 10,
              letterSpacing: "0.2em",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            photography pending
          </span>
        )}

        {!entry.inStock && (
          <span
            className="mono"
            style={{
              position: "absolute",
              top: 14,
              left: 14,
              padding: "6px 10px",
              fontSize: 9.5,
              letterSpacing: "0.2em",
              color: "var(--dim)",
              background: "var(--scrim)",
              border: "1px solid var(--border)",
            }}
          >
            SOLD OUT
          </span>
        )}

        {entry.price.discountPct ? (
          <span
            className="mono"
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              padding: "6px 10px",
              fontSize: 9.5,
              letterSpacing: "0.18em",
              color: "var(--accent)",
              background: "var(--scrim)",
              border: "1px solid var(--border)",
            }}
          >
            −{entry.price.discountPct}%
          </span>
        ) : null}
      </div>

      <div style={{ padding: "22px 22px 24px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", color: "var(--faint)" }}>
          {entry.brand.toUpperCase()}
        </span>

        <h3 className="serif" style={{ margin: 0, fontSize: 25, fontWeight: 400, lineHeight: 1.12 }}>
          {entry.modelName ?? entry.modelNumber}
        </h3>

        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, fontWeight: 300, color: "var(--muted)", flex: 1 }}>
          {entry.tagline}
        </p>

        {/* What it costs, what it listed at, and what that saves — read as one
            line, so the saving is next to the figure it applies to rather than
            floating over the photograph. */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 17, letterSpacing: "0.01em" }}>
            {entry.price.selling === null ? "Price on request" : formatInr(entry.price.selling)}
          </span>
          {entry.price.mrp ? (
            <span
              className="mono"
              style={{ fontSize: 11.5, color: "var(--faint)", textDecoration: "line-through" }}
            >
              {formatInr(entry.price.mrp)}
            </span>
          ) : null}
          {entry.price.discountPct ? (
            <span
              className="mono"
              style={{ fontSize: 10.5, letterSpacing: "0.14em", color: "var(--accent)" }}
            >
              −{entry.price.discountPct}%
            </span>
          ) : null}
        </div>
        {entry.price.mrp && entry.price.selling && entry.price.mrp > entry.price.selling ? (
          <span style={{ fontSize: 12, fontWeight: 300, color: "var(--muted)", marginTop: -4 }}>
            You save {formatInr(entry.price.mrp - entry.price.selling)}
          </span>
        ) : null}

        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.18em", color: "var(--faint)" }}>
          REF {entry.modelNumber.toUpperCase()}
        </span>
      </div>
    </Link>
  );
}
