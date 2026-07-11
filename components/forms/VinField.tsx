"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { decodeVinAction } from "@/app/(app)/vin/actions";
import {
  normalizeVin,
  validateOptionalVin,
  type VinDecodeResult,
} from "@/lib/vin";

export type VinAutofillSuggestion = {
  year?: string;
  make?: string;
  model?: string;
};

type Props = {
  name?: string;
  defaultValue?: string | null;
  /** Called when decode succeeds with useful year/make/model. */
  onSuggestion?: (suggestion: VinAutofillSuggestion) => void;
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

export function VinField({
  name = "vin",
  defaultValue,
  onSuggestion,
}: Props) {
  const [value, setValue] = useState(() =>
    defaultValue ? normalizeVin(defaultValue) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [decode, setDecode] = useState<VinDecodeResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const lastDecoded = useRef<string>("");
  const onSuggestionRef = useRef(onSuggestion);
  onSuggestionRef.current = onSuggestion;

  function runValidation(next: string): boolean {
    const result = validateOptionalVin(next);
    if (!result.ok) {
      setError(result.error);
      setDecode(null);
      return false;
    }
    setError(null);
    return Boolean(result.vin);
  }

  function requestDecode(raw: string) {
    const result = validateOptionalVin(raw);
    if (!result.ok || !result.vin) {
      setDecode(null);
      return;
    }
    if (lastDecoded.current === result.vin) return;
    lastDecoded.current = result.vin;

    startTransition(async () => {
      const decoded = await decodeVinAction(result.vin);
      setDecode(decoded);
      if (decoded.valid && decoded.fullyDecoded) {
        onSuggestionRef.current?.({
          year: decoded.fields.modelYear ?? undefined,
          make: decoded.fields.make ?? undefined,
          model: decoded.fields.model ?? undefined,
        });
      } else if (decoded.valid && decoded.local?.modelYear != null) {
        onSuggestionRef.current?.({
          year: String(decoded.local.modelYear),
          make: decoded.fields.make ?? decoded.local.manufacturerHint ?? undefined,
          model: decoded.fields.model ?? undefined,
        });
      }
    });
  }

  useEffect(() => {
    if (!defaultValue) return;
    const normalized = normalizeVin(defaultValue);
    if (normalized.length === 17 && validateOptionalVin(normalized).ok) {
      requestDecode(normalized);
    }
    // Initial mount only — intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displacement = decode ? formatDisplacement(decode) : null;

  return (
    <div className="block">
      <label className="block">
        <span className="field-label">VIN</span>
        <input
          className="input font-mono tracking-wide uppercase"
          name={name}
          value={value}
          autoComplete="off"
          spellCheck={false}
          maxLength={17}
          placeholder="17-character VIN"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "vin-error" : "vin-hint"}
          onChange={(event) => {
            const next = normalizeVin(event.target.value).slice(0, 17);
            setValue(next);
            if (!next) {
              setError(null);
              setDecode(null);
              lastDecoded.current = "";
              return;
            }
            if (next.length === 17) {
              if (runValidation(next)) requestDecode(next);
            } else {
              setError(null);
              setDecode(null);
            }
          }}
          onBlur={() => {
            if (!value) {
              setError(null);
              return;
            }
            if (runValidation(value)) requestDecode(value);
          }}
        />
      </label>
      {error ? (
        <span id="vin-error" role="alert" className="field-hint text-[var(--status-danger)]">
          {error}
        </span>
      ) : (
        <span id="vin-hint" className="field-hint">
          Optional, but missing VIN is flagged in the shop. When entered, must be a valid 17-character VIN.
        </span>
      )}

      {isPending ? (
        <p className="mt-2 text-sm text-zinc-500">Looking up vehicle…</p>
      ) : null}

      {decode && decode.valid ? (
        <div
          className="mt-3 rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800"
          role="status"
        >
          <p className="font-medium text-zinc-900">
            {[
              decode.fields.modelYear,
              decode.fields.make ?? decode.local?.manufacturerHint,
              decode.fields.model,
            ]
              .filter(Boolean)
              .join(" ") || "Vehicle details"}
          </p>
          <ul className="mt-1 space-y-0.5 text-zinc-600">
            {decode.fields.vehicleType ? (
              <li>Type: {decode.fields.vehicleType}</li>
            ) : null}
            {decode.fields.bodyClass ? (
              <li>Body: {decode.fields.bodyClass}</li>
            ) : null}
            {displacement ? <li>Engine: {displacement}</li> : null}
            {decode.fields.engineHP ? (
              <li>Power: {decode.fields.engineHP} hp</li>
            ) : null}
            {decode.fields.motorcycleChassisType ? (
              <li>Chassis: {decode.fields.motorcycleChassisType}</li>
            ) : null}
            {decode.fields.manufacturer ? (
              <li>Manufacturer: {decode.fields.manufacturer}</li>
            ) : null}
            {decode.local?.region && !decode.fullyDecoded ? (
              <li>
                Region: {decode.local.region}
                {decode.local.wmi ? ` (WMI ${decode.local.wmi})` : ""}
              </li>
            ) : null}
          </ul>
          {decode.message ? (
            <p className="mt-1 text-amber-800">{decode.message}</p>
          ) : decode.source === "nhtsa" ? (
            <p className="mt-1 text-xs text-zinc-500">Decoded via NHTSA vPIC</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
