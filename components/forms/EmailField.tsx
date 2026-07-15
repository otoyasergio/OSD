"use client";

import { useState } from "react";
import { normalizeEmailInput } from "@/lib/email/normalize";

type Props = {
  defaultValue?: string | null;
  error?: string | null;
  onValueChange?: (value: string) => void;
};

export function EmailField({ defaultValue, error, onValueChange }: Props) {
  const inputId = "email";
  const errorId = error ? `${inputId}-error` : undefined;
  const [value, setValue] = useState(() => normalizeEmailInput(defaultValue));

  return (
    <div className="block">
      <label htmlFor={inputId} className="field-label">
        Email
        <span className="ml-1 text-[var(--status-danger)]">*</span>
      </label>
      <input
        id={inputId}
        className="input"
        name="email"
        type="email"
        inputMode="email"
        value={value}
        required
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        onChange={(event) => {
          const nextValue = normalizeEmailInput(event.target.value);
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
