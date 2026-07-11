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
  const [decode, setDecode] = useState<VinDecodeResult | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setDecode(null);
    if (!vin?.trim()) return;
    const value = vin.trim().toUpperCase();
    startTransition(async () => {
      const result = await decodeVinAction(value);
      setDecode(result);
    });
  }, [vin]);

  if (!vin?.trim()) {
    return (
      <p className="mt-2 text-sm text-amber-800" role="status">
        Missing VIN — add it on the motorcycle record when you can.
      </p>
    );
  }

  if (isPending && !decode) {
    return <p className="mt-2 text-sm text-zinc-500">Looking up VIN…</p>;
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
      className="mt-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800"
      role="status"
    >
      <p className="font-mono text-xs text-zinc-500">{decode.vin}</p>
      {title ? <p className="font-medium text-zinc-900">{title}</p> : null}
      <ul className="mt-1 space-y-0.5 text-zinc-600">
        {decode.fields.vehicleType ? (
          <li>Type: {decode.fields.vehicleType}</li>
        ) : null}
        {decode.fields.bodyClass ? <li>Body: {decode.fields.bodyClass}</li> : null}
        {displacement ? <li>Engine: {displacement}</li> : null}
      </ul>
      {decode.message ? (
        <p className="mt-1 text-amber-800">{decode.message}</p>
      ) : null}
    </div>
  );
}
