"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { LightboxPhoto } from "@/lib/photos/lightbox";

/**
 * Full-screen photo viewer. Rendered only while open (parent keeps the
 * open/closed state), so mounting doubles as "open".
 *
 * Keyboard: ArrowLeft / ArrowRight navigate, Escape closes, Tab is trapped.
 */
export function PhotoLightbox({
  photos,
  initialIndex,
  onClose,
}: {
  photos: LightboxPhoto[];
  initialIndex: number;
  onClose: () => void;
}) {
  const count = photos.length;
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), count - 1)
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusTo = useRef<Element | null>(null);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + count) % count);
  }, [count]);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % count);
  }, [count]);

  // Focus the dialog on open, lock body scroll, restore both on close.
  useEffect(() => {
    restoreFocusTo.current = document.activeElement;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (restoreFocusTo.current instanceof HTMLElement) {
        restoreFocusTo.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
        return;
      }
      if (event.key === "Tab") {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [goPrev, goNext, onClose]);

  const photo = photos[index];
  if (!photo) return null;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Photo viewer — ${photo.label}, photo ${index + 1} of ${count}`}
      tabIndex={-1}
      className="photo-lightbox"
    >
      <div className="photo-lightbox-header">
        <div className="min-w-0">
          <p className="photo-lightbox-title">{photo.label}</p>
          <p className="photo-lightbox-counter" aria-live="polite">
            {index + 1} of {count}
          </p>
        </div>
        <button
          type="button"
          className="photo-lightbox-btn"
          aria-label="Close photo viewer"
          onClick={onClose}
        >
          <X size={22} aria-hidden />
        </button>
      </div>

      <div
        className="photo-lightbox-stage"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {count > 1 ? (
          <button
            type="button"
            className="photo-lightbox-btn photo-lightbox-nav photo-lightbox-nav--prev"
            aria-label="Previous photo"
            onClick={goPrev}
          >
            <ChevronLeft size={26} aria-hidden />
          </button>
        ) : null}
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
        <img src={photo.src} alt={photo.label} className="photo-lightbox-img" />
        {count > 1 ? (
          <button
            type="button"
            className="photo-lightbox-btn photo-lightbox-nav photo-lightbox-nav--next"
            aria-label="Next photo"
            onClick={goNext}
          >
            <ChevronRight size={26} aria-hidden />
          </button>
        ) : null}
      </div>

      {photo.caption ? <p className="photo-lightbox-caption">{photo.caption}</p> : null}
    </div>,
    document.body
  );
}
