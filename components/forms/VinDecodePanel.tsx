"use client";

import { useEffect, useState, useTransition } from "react";
import { decodeVinAction } from "@/app/(app)/vin/actions";
import type { VinDecodeResult } from "@/lib/vin";

type Props = {
  vin: string | null | undefined;
};

function formatDisplacement(result: VinDecodeResult): string | null {
  const { displacementL, displacementCC } = result.fields;
  if (displacementL) {
    const liters = Number(displacementL);
    if (Number.isFinite(liters) && liters > 0) {
      return `${(liters * 1000).toFixed(0)} cc`;
    }
    return `${displacementL} L`;
  }
  if (displacementCC) return `${displacementCC} cc`;
  return null;
}

export function VinDecodePanel({ vin }: Props) {
  const [lookup, setLookup] = useState<{
    vin: string;
    result: VinDecodeResult;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const value = vin?.trim() ? vin.trim().toUpperCase() : null;

  useEffect(() => {
    if (!value) return;
    startTransition(async () => {
      const result = await decodeVinAction(value);
      setLookup({ vin: value, result });
    });
  }, [value]);

  // Only show a decode that matches the current VIN; stale lookups read as null.
  const decode = value && lookup?.vin === value ? lookup.result : null;

  if (!vin?.trim()) {
    return (
      <p className="mt-2 text-sm text-amber-800" role="status">
        Missing VIN — add it on the motorcycle record when you can.
      </p>
    );
  }

  if (isPending && !decode) {
    return <p className="mt-2 text-sm text-[var(--status-neutral)]">Looking up VIN…</p>;
  }

  if (!decode) return null;

  if (!decode.valid) {
    return (
      <p className="mt-2 text-sm text-[var(--status-danger)]" role="alert">
        Stored VIN may be invalid: {decode.validationError}
      </p>
    );
  }

  const title = [
    decode.fields.modelYear,
    decode.fields.make ?? decode.local?.manufacturerHint,
    decode.fields.model,
  ]
    .filter(Boolean)
    .join(" ");
  const displacement = formatDisplacement(decode);

  return (
    <div
      className="mt-3 rounded border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-foreground"
      role="status"
    >
      <p className="font-mono text-xs text-[var(--status-neutral)]">{decode.vin}</p>
      {title ? <p className="font-medium text-foreground">{title}</p> : null}
      <ul className="mt-1 space-y-0.5 text-[var(--status-neutral)]">
        {decode.fields.vehicleType ? <li>Type: {decode.fields.vehicleType}</li> : null}
        {decode.fields.bodyClass ? <li>Body: {decode.fields.bodyClass}</li> : null}
        {displacement ? <li>Engine: {displacement}</li> : null}
      </ul>
      {decode.message ? <p className="mt-1 text-amber-800">{decode.message}</p> : null}
    </div>
  );
}
