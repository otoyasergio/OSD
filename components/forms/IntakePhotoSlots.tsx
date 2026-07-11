"use client";

import { useEffect, useState } from "react";
import type { PhotoCategory } from "@/lib/database/types";
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

export function IntakePhotoSlots({
  categories,
  value,
  onChange,
  disabled = false,
  htmlRequired = true,
}: Props) {
  const slots = slotsFor(categories);
  const [previews, setPreviews] = useState<
    Partial<Record<PhotoCategory, string>>
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

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {slots.map((slot) => {
        const preview = previews[slot.category];
        const selected = value[slot.category];
        const inputId = `intake_${slot.category}`;

        return (
          <label
            key={slot.category}
            htmlFor={inputId}
            className={`flex min-h-36 cursor-pointer flex-col overflow-hidden rounded border bg-white transition ${
              selected
                ? "border-zinc-900 ring-2 ring-zinc-900/10"
                : "border-dashed border-zinc-300 hover:border-zinc-500"
            } ${disabled ? "pointer-events-none opacity-60" : ""}`}
          >
            <span className="border-b border-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900">
              {slot.label} <span className="text-red-600">*</span>
            </span>
            <span className="relative flex flex-1 items-center justify-center bg-zinc-50">
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview}
                  alt={`${slot.label} preview`}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <span className="px-4 py-8 text-center text-sm text-zinc-500">
                  Tap to take or choose photo
                </span>
              )}
            </span>
            <input
              id={inputId}
              className="sr-only"
              type="file"
              name={`intake_${slot.category}`}
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/*"
              // Prefer rear camera when the device offers a capture UI (iPad/Safari).
              capture="environment"
              disabled={disabled}
              required={htmlRequired && !selected}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                onChange({ ...value, [slot.category]: file });
              }}
            />
          </label>
        );
      })}
    </div>
  );
}
