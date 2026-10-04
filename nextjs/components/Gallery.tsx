"use client";
import Image from "next/image";
import { useState } from "react";
import type { Backdrop } from "@/agent/types";
import { lightWash } from "@/lib/backdrop-light";

/**
 * Only what a picture needs to be drawn.
 *
 * This is a client component, so whatever it is handed is serialised into the
 * page for anyone to read. A full image record carries sourceUrl and
 * sourcePage — the shop the photograph was found on — which is the shop's own
 * research note and has no business on a customer's screen. Narrowing the type
 * here means the compiler refuses a listing that smuggles them back in.
 */
export interface GalleryImage {
  url: string;
  width: number;
  height: number;
  alt: string;
  blurDataURL: string | null;
  hasAlpha: boolean;
}

export default function Gallery({
  images,
  title,
  backdrop,
}: {
  images: GalleryImage[];
  title: string;
  backdrop?: Backdrop;
}) {
  const [active, setActive] = useState(0);
  const current = images[active];

  if (!current) {
    return (
      <div
        style={{
          aspectRatio: "1 / 1",
          border: "1px solid var(--border)",
          backgroundColor: "var(--well)",
          backgroundImage: "repeating-linear-gradient(135deg, var(--card-hover) 0 2px, var(--well) 2px 9px)",
          display: "flex",
          alignItems: "flex-end",
          padding: 18,
        }}
      >
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.2em", color: "var(--muted)", textTransform: "uppercase" }}>
          photography pending
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        className={backdrop && current.hasAlpha ? "card-stage" : undefined}
        style={{
          position: "relative",
          aspectRatio: "1 / 1",
          border: "1px solid var(--line)",
          background: "var(--well)",
          // Cut-out watches sit on the backdrop matched to their colour.
          backgroundImage: backdrop && current.hasAlpha ? backdrop.css : undefined,
          ...(backdrop && current.hasAlpha ? { ["--stage-light" as string]: lightWash(backdrop.id) } : {}),
          overflow: "hidden",
        }}
      >
        <Image
          key={current.url}
          src={current.url}
          alt={current.alt || title}
          fill
          priority
          sizes="(max-width: 900px) 100vw, 46vw"
          placeholder={current.blurDataURL ? "blur" : "empty"}
          blurDataURL={current.blurDataURL ?? undefined}
          style={{ objectFit: "contain", padding: 30 }}
        />
      </div>

      {images.length > 1 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {images.map((image, index) => (
            <button
              key={image.url}
              type="button"
              onClick={() => setActive(index)}
              aria-label={`View image ${index + 1}`}
              aria-current={index === active}
              style={{
                position: "relative",
                width: 78,
                height: 78,
                padding: 0,
                cursor: "pointer",
                background: "var(--well)",
                border: `1px solid ${index === active ? "var(--accent)" : "var(--line)"}`,
                transition: "border-color .35s",
              }}
            >
              <Image
                src={image.url}
                alt=""
                fill
                sizes="78px"
                style={{ objectFit: "contain", padding: 6, opacity: index === active ? 1 : 0.6 }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
