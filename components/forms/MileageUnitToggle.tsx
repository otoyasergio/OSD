"use client";

import type { MileageUnit } from "@/lib/mileage/format";

type Props = {
  value: MileageUnit;
  onChange: (unit: MileageUnit) => void;
  label?: string;
  name?: string;
};

const UNITS = [
  ["km", "km"],
  ["mi", "miles"],
] as const;

export function MileageUnitToggle({ value, onChange, label = "Unit", name }: Props) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
      </legend>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className="grid min-h-11 grid-cols-2 overflow-hidden rounded border border-[var(--border-strong)] bg-white">
        {UNITS.map(([unit, unitLabel]) => {
          const selected = value === unit;
          return (
            <button
              key={unit}
              type="button"
              aria-pressed={selected}
              className={`min-w-20 px-4 py-2 text-sm font-semibold transition-colors${
                selected
                  ? " bg-[var(--foreground)] text-white"
                  : " bg-white text-foreground hover:bg-[var(--surface-muted)]"
              }`}
              onClick={() => onChange(unit)}
            >
              {unitLabel}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
