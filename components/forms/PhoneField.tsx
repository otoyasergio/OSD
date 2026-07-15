"use client";

import { useState } from "react";
import { formatCanadianPhoneInput } from "@/lib/phone/format";

type Props = {
  defaultValue?: string | null;
  error?: string | null;
  onValueChange?: (value: string) => void;
};

export function PhoneField({ defaultValue, error, onValueChange }: Props) {
  const inputId = "phone";
  const errorId = error ? `${inputId}-error` : undefined;
  const [value, setValue] = useState(() =>
    formatCanadianPhoneInput(defaultValue ?? "")
  );

  return (
    <div className="block">
      <label htmlFor={inputId} className="field-label">
        Phone
        <span className="ml-1 text-[var(--status-danger)]">*</span>
      </label>
      <input
        id={inputId}
        className="input"
        name="phone"
        type="tel"
        inputMode="tel"
        value={value}
        required
        autoComplete="tel"
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        onChange={(event) => {
          const nextValue = formatCanadianPhoneInput(event.target.value);
          setValue(nextValue);
          onValueChange?.(nextValue);
        }}
      />
      {error ? (
        <span
          id={errorId}
          className="mt-1 block text-sm text-[var(--status-danger)]"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
