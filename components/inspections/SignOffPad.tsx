"use client";

import { useState } from "react";
import { SignatureCanvas } from "@/components/contracts/SignatureCanvas";

/**
 * Drawn signature pad for tech sign-offs (arrival inspection, QC, final inspection).
 * Writes the data URL into a hidden form field named `signature_data_url`.
 */
export function SignOffPad({
  label = "Your signature",
  required = true,
  fieldName = "signature_data_url",
}: {
  label?: string;
  required?: boolean;
  fieldName?: string;
}) {
  const [signature, setSignature] = useState<string | null>(null);
  const [cleared, setCleared] = useState(0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          {label}
          {required ? <span className="text-red-700"> *</span> : null}
        </span>
        <button
          type="button"
          className="text-sm font-medium text-[var(--accent)] underline"
          onClick={() => {
            setSignature(null);
            setCleared((n) => n + 1);
          }}
        >
          Clear
        </button>
      </div>
      <div
        key={cleared}
        className="overflow-hidden rounded border border-[var(--border-strong)] bg-white"
      >
        <SignatureCanvas onChange={setSignature} height={140} />
      </div>
      <input type="hidden" name={fieldName} value={signature ?? ""} />
      {!signature && required ? (
        <p className="text-xs text-[var(--status-neutral)]">
          Draw your signature before submitting.
        </p>
      ) : null}
    </div>
  );
}
