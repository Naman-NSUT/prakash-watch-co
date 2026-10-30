"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryImage } from "./Gallery";
import { mediaPreviewUrl } from "@/lib/media";

/**
 * A photograph at the size it was taken.
 *
 * A watch is bought on its detail — the finish of a bezel, the printing on a
 * dial, whether a bracelet is brushed or polished — and a 520px square on a
 * product page shows none of it. Opening the picture full-screen and letting it
 * be magnified is the closest the website gets to handing it across a counter.
 *
 * Two ways to magnify, because people reach for both: press to zoom in and drag
 * to move around, or pinch on a phone, which the browser does natively once the
 * picture is bigger than its frame. Arrows and the keyboard move between
 * photographs without closing.
 */
export default function Lightbox({
  images,
  title,
  index,
  onClose,
  onIndex,
}: {
  images: GalleryImage[];
  title: string;
  index: number;
  onClose: () => void;
  onIndex: (next: number) => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const closer = useRef<HTMLButtonElement>(null);
  const image = images[index];

  const move = useCallback(
    (step: number) => {
      setZoomed(false);
      onIndex((index + step + images.length) % images.length);
    },
    [index, images.length, onIndex],
  );

  useEffect(() => {
    const root = document.documentElement;
    const held = root.style.overflow;
    root.style.overflow = "hidden";
    closer.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") move(1);
      if (event.key === "ArrowLeft") move(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      root.style.overflow = held;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, move]);

  if (!image) return null;

  /** Zoom towards the point pressed, so the detail wanted is the detail shown. */
  function toggleZoom(event: React.MouseEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    setOrigin({
      x: ((event.clientX - box.left) / box.width) * 100,
      y: ((event.clientY - box.top) / box.height) * 100,
    });
    setZoomed((value) => !value);
  }

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`${title} — photographs`}>
      <button type="button" className="lightbox-scrim" onClick={onClose} aria-label="Close" tabIndex={-1} />

      <div className="lightbox-bar">
        <span className="mono lightbox-count">
          {index + 1} / {images.length}
        </span>
        <button ref={closer} type="button" className="lightbox-close" onClick={onClose} aria-label="Close the photographs">
          <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div
        className="lightbox-stage"
        data-zoomed={zoomed}
        onClick={toggleZoom}
        role="button"
        tabIndex={0}
        aria-label={zoomed ? "Zoom out" : "Zoom in"}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setZoomed((value) => !value);
          }
        }}
      >
        <Image
          key={image.url}
          src={image.url}
          alt={image.alt || title}
          fill
          sizes="100vw"
          priority
          placeholder={image.blurDataURL ? "blur" : "empty"}
          blurDataURL={image.blurDataURL ?? undefined}
          style={{
            objectFit: "contain",
            transform: zoomed ? "scale(2.4)" : "scale(1)",
            transformOrigin: `${origin.x}% ${origin.y}%`,
          }}
        />
      </div>

      {images.length > 1 && (
        <>
          <button type="button" className="lightbox-arrow" data-side="left" onClick={() => move(-1)} aria-label="Previous photograph">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <button type="button" className="lightbox-arrow" data-side="right" onClick={() => move(1)} aria-label="Next photograph">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M9 5l7 7-7 7" />
            </svg>
          </button>

          <div className="lightbox-film">
            {images.map((thumb, slot) => (
              <button
                key={thumb.url}
                type="button"
                onClick={() => { setZoomed(false); onIndex(slot); }}
                aria-label={`Photograph ${slot + 1}`}
                aria-current={slot === index}
                data-on={slot === index}
              >
                <Image src={mediaPreviewUrl(thumb.url, 160)} alt="" fill sizes="56px" style={{ objectFit: "contain", padding: 4 }} />
              </button>
            ))}
          </div>
        </>
      )}

      <p className="mono lightbox-hint">{zoomed ? "Press to zoom out" : "Press the photograph to magnify"}</p>
    </div>
  );
}
