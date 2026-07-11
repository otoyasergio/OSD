"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { PhotoCategory } from "@/lib/database/types";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { CREATE_INTAKE_PHOTO_SLOTS } from "@/lib/status/labels";

export type IntakePhotoSelection = Partial<Record<PhotoCategory, File | null>>;

type SlotDef = {
  category: PhotoCategory;
  label: string;
};

type Props = {
  /** When set, only these categories are shown (recovery of failed uploads). */
  categories?: PhotoCategory[];
  value: IntakePhotoSelection;
  onChange: (next: IntakePhotoSelection) => void;
  disabled?: boolean;
  /** When false, skip HTML required so step wizards can gate submit themselves. */
  htmlRequired?: boolean;
};

function slotsFor(categories?: PhotoCategory[]): SlotDef[] {
  if (!categories || categories.length === 0) {
    return CREATE_INTAKE_PHOTO_SLOTS;
  }
  const wanted = new Set(categories);
  return CREATE_INTAKE_PHOTO_SLOTS.filter((slot) => wanted.has(slot.category));
}

export function allRequiredIntakeSelected(
  value: IntakePhotoSelection,
  categories: PhotoCategory[] = CREATE_INTAKE_PHOTO_SLOTS.map((s) => s.category)
): boolean {
  return categories.every((category) => {
    const file = value[category];
    return file instanceof File && file.size > 0;
  });
}

function SlotIcon({ category }: { category: PhotoCategory }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  switch (category) {
    case "front":
      return (
        <svg {...common}>
          <circle cx="12" cy="10" r="3.5" />
          <path d="M5 18c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" />
          <path d="M8 7.5 6.5 5M16 7.5 17.5 5" />
        </svg>
      );
    case "rear":
      return (
        <svg {...common}>
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M10 12h4M12 10v4" />
          <path d="M5 19h14" />
        </svg>
      );
    case "left_side":
      return (
        <svg {...common}>
          <path d="M4 15h3l2-5h6l2 3h3" />
          <circle cx="8" cy="17" r="1.75" />
          <circle cx="16.5" cy="17" r="1.75" />
          <path d="M9 10V8h4" />
        </svg>
      );
    case "right_side":
      return (
        <svg {...common}>
          <path d="M20 15h-3l-2-5H9L7 13H4" />
          <circle cx="16" cy="17" r="1.75" />
          <circle cx="7.5" cy="17" r="1.75" />
          <path d="M15 10V8h-4" />
        </svg>
      );
    case "vin":
      return (
        <svg {...common}>
          <rect x="4" y="6" width="16" height="12" rx="2" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
    case "odometer":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 12 15.5 9" />
          <path d="M12 5v1.5M19 12h-1.5M12 19v-1.5M5 12h1.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.2-1.5h4.6L15.5 6H17.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function LibraryIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m3 15 5-4 4 3 3-2 6 5" />
      <circle cx="9" cy="9" r="1.5" />
    </svg>
  );
}

export function IntakePhotoSlots({
  categories,
  value,
  onChange,
  disabled = false,
  htmlRequired = true,
}: Props) {
  const slots = slotsFor(categories);
  const titleId = useId();
  const [previews, setPreviews] = useState<
    Partial<Record<PhotoCategory, string>>
  >({});
  const [chooserCategory, setChooserCategory] = useState<PhotoCategory | null>(
    null
  );
  const cameraRefs = useRef<Partial<Record<PhotoCategory, HTMLInputElement | null>>>(
    {}
  );
  const libraryRefs = useRef<
    Partial<Record<PhotoCategory, HTMLInputElement | null>>
  >({});

  useEffect(() => {
    const next: Partial<Record<PhotoCategory, string>> = {};
    const urls: string[] = [];

    for (const slot of CREATE_INTAKE_PHOTO_SLOTS) {
      const file = value[slot.category];
      if (file instanceof File && file.size > 0) {
        const url = URL.createObjectURL(file);
        next[slot.category] = url;
        urls.push(url);
      }
    }

    setPreviews(next);
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [value]);

  useEffect(() => {
    if (!chooserCategory) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChooserCategory(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooserCategory]);

  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");
  const chooserSlot = chooserCategory
    ? slots.find((slot) => slot.category === chooserCategory) ??
      CREATE_INTAKE_PHOTO_SLOTS.find((slot) => slot.category === chooserCategory)
    : null;

  return (
    <>
      <div className="intake-photo-grid">
        {slots.map((slot) => {
          const preview = previews[slot.category];
          const selected = value[slot.category];
          const filled = selected instanceof File && selected.size > 0;

          return (
            <div
              key={slot.category}
              className={`intake-photo-slot${filled ? " is-filled" : ""}${
                disabled ? " is-disabled" : ""
              }`}
            >
              <button
                type="button"
                className="intake-photo-slot-trigger"
                disabled={disabled}
                aria-label={
                  filled
                    ? `Retake ${slot.label} photo`
                    : `Add ${slot.label} photo`
                }
                onClick={() => setChooserCategory(slot.category)}
              >
                <span className="intake-photo-slot-chrome">
                  <span className="intake-photo-slot-title">
                    <SlotIcon category={slot.category} />
                    <span className="intake-photo-slot-title-text">
                      {slot.label}{" "}
                      <span className="intake-photo-slot-req">*</span>
                    </span>
                  </span>
                  <span className="intake-photo-slot-badge">
                    {filled ? "Ready" : "Required"}
                  </span>
                </span>
                <span className="intake-photo-slot-body">
                  {preview ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={preview}
                        alt={`${slot.label} preview`}
                      />
                      <span className="intake-photo-slot-check">
                        <CheckIcon />
                      </span>
                      <span className="intake-photo-slot-retake">
                        Tap to retake
                      </span>
                    </>
                  ) : (
                    <span className="intake-photo-slot-empty">
                      <span className="intake-photo-slot-icon">
                        <CameraIcon />
                      </span>
                      <span className="intake-photo-slot-hint">
                        Tap to add photo
                      </span>
                      <span className="intake-photo-slot-subhint">
                        Camera or photo library
                      </span>
                    </span>
                  )}
                </span>
              </button>
              {/* Native required sentinel — dual file inputs cannot both be required. */}
              {htmlRequired ? (
                <input
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden
                  required={!filled}
                  value={filled ? "1" : ""}
                  onChange={() => {}}
                  name={`intake_${slot.category}_present`}
                />
              ) : null}
              <input
                ref={(el) => {
                  cameraRefs.current[slot.category] = el;
                }}
                className="photo-file-input"
                type="file"
                accept={cameraProps.accept}
                capture={cameraProps.capture}
                tabIndex={-1}
                disabled={disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  onChange({ ...value, [slot.category]: file });
                  event.target.value = "";
                }}
              />
              <input
                ref={(el) => {
                  libraryRefs.current[slot.category] = el;
                }}
                className="photo-file-input"
                type="file"
                accept={libraryProps.accept}
                tabIndex={-1}
                disabled={disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  onChange({ ...value, [slot.category]: file });
                  event.target.value = "";
                }}
              />
            </div>
          );
        })}
      </div>

      {chooserSlot ? (
        <div
          className="photo-source-sheet"
          role="presentation"
          onClick={() => setChooserCategory(null)}
        >
          <div
            className="photo-source-sheet-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <p id={titleId} className="photo-source-sheet-title">
              Add {chooserSlot.label} photo
            </p>
            <p className="photo-source-sheet-lede">
              Take a new photo or choose one from your library.
            </p>
            <button
              type="button"
              className="btn btn-primary photo-source-sheet-action"
              onClick={() => {
                // Must stay synchronous for iOS Safari user-gesture rules.
                cameraRefs.current[chooserSlot.category]?.click();
                setChooserCategory(null);
              }}
            >
              <CameraIcon />
              Take photo
            </button>
            <button
              type="button"
              className="btn btn-secondary photo-source-sheet-action"
              onClick={() => {
                libraryRefs.current[chooserSlot.category]?.click();
                setChooserCategory(null);
              }}
            >
              <LibraryIcon />
              Upload from library
            </button>
            <button
              type="button"
              className="btn btn-ghost photo-source-sheet-cancel"
              onClick={() => setChooserCategory(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function CameraIcon(): ReactNode {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h2l1.2-1.5h4.6L15.5 6H17.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5v-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
