"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  acceptVinTransferAction,
  lookupVinInGarageAction,
} from "@/app/(app)/motorcycles/actions";
import { decodeVinAction } from "@/app/(app)/vin/actions";
import type { VinOwnershipConflict } from "@/lib/services/motorcycles";
import {
  normalizeVin,
  summarizeDecode,
  validateOptionalVin,
  type VinDecodeResult,
} from "@/lib/vin";
import { VinOwnershipConflictNotice } from "@/components/forms/VinOwnershipConflictNotice";

type Props = {
  customerId: string;
  currentCustomerName?: string;
  onSelectMotorcycle: (motorcycleId: string) => void;
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

function buildCreateHref(
  customerId: string,
  decodedVin: string,
  decode: VinDecodeResult | null
): string {
  const params = new URLSearchParams({
    customer_id: customerId,
    vin: decodedVin,
    return_to: `/work_orders/new?customer_id=${customerId}`,
  });
  const year =
    decode?.fields.modelYear ??
    (decode?.local?.modelYear != null ? String(decode.local.modelYear) : "");
  const make = decode?.fields.make ?? decode?.local?.manufacturerHint ?? "";
  const model = decode?.fields.model ?? "";
  if (year) params.set("year", year);
  if (make) params.set("make", make);
  if (model) params.set("model", model);
  return `/motorcycles/new?${params.toString()}`;
}

export function FindMotorcycleByVin({
  customerId,
  currentCustomerName,
  onSelectMotorcycle,
}: Props) {
  const router = useRouter();
  const [vin, setVin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [notFoundVin, setNotFoundVin] = useState<string | null>(null);
  const [decode, setDecode] = useState<VinDecodeResult | null>(null);
  const [conflict, setConflict] = useState<VinOwnershipConflict | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function clear() {
    setVin("");
    setMessage(null);
    setNotFoundVin(null);
    setDecode(null);
    setConflict(null);
    setTransferError(null);
  }

  function lookup() {
    setMessage(null);
    setConflict(null);
    setTransferError(null);
    setNotFoundVin(null);
    setDecode(null);
    const validation = validateOptionalVin(vin);
    if (!validation.ok || !validation.vin) {
      setMessage(validation.ok ? "Enter a VIN to look up." : validation.error);
      return;
    }
    if (!customerId) {
      setMessage("Select a customer first.");
      return;
    }

    startTransition(async () => {
      const result = await lookupVinInGarageAction({
        vin: validation.vin,
        currentCustomerId: customerId,
      });

      if (result.kind === "same_garage") {
        onSelectMotorcycle(result.motorcycle_id);
        setMessage(`Selected ${result.bike_label} from this garage.`);
        setConflict(null);
        return;
      }

      if (result.kind === "other_owner") {
        setConflict(result.conflict);
        setMessage(null);
        return;
      }

      setNotFoundVin(validation.vin);
      setMessage("No motorcycle with that VIN yet.");
      try {
        const decoded = await decodeVinAction(validation.vin);
        setDecode(decoded);
      } catch {
        setDecode(null);
      }
    });
  }

  function acceptTransfer() {
    if (!conflict || !customerId) return;
    startTransition(async () => {
      const result = await acceptVinTransferAction({
        motorcycle_id: conflict.motorcycle_id,
        new_customer_id: customerId,
        redirect: false,
      });
      if (result?.error) {
        setTransferError(result.error);
        return;
      }
      onSelectMotorcycle(result.motorcycle_id ?? conflict.motorcycle_id);
      clear();
      router.refresh();
    });
  }

  const createHref =
    notFoundVin && customerId ? buildCreateHref(customerId, notFoundVin, decode) : null;
  const bikeTitle = decode?.valid ? summarizeDecode(decode) : null;
  const displacement = decode ? formatDisplacement(decode) : null;

  return (
    <div className="mt-4 rounded border border-[var(--border)] bg-white px-3 py-3">
      <p className="text-sm font-medium text-foreground">Find by VIN</p>
      <p className="mt-0.5 text-xs text-[var(--status-neutral)]">
        If this bike already exists for another customer, you can transfer it here instead
        of creating a duplicate.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          className="input min-h-11 min-w-[14rem] flex-1 font-mono tracking-wide uppercase"
          value={vin}
          maxLength={17}
          autoComplete="off"
          spellCheck={false}
          placeholder="17-character VIN"
          onChange={(event) => {
            setVin(normalizeVin(event.target.value).slice(0, 17));
            setConflict(null);
            setMessage(null);
            setNotFoundVin(null);
            setDecode(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              lookup();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          disabled={pending || !customerId}
          onClick={lookup}
        >
          {pending ? "Looking up…" : "Look up"}
        </button>
      </div>

      {message && !notFoundVin ? (
        <p className="mt-2 text-sm text-foreground" role="status">
          {message}
        </p>
      ) : null}

      {notFoundVin ? (
        <div
          className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-3"
          role="status"
        >
          <p className="text-sm text-amber-950">
            No motorcycle with that VIN yet. Create one for this customer, or check the
            number.
          </p>
          {pending && !decode ? (
            <p className="mt-2 text-sm text-[var(--status-neutral)]">
              Identifying bike from VIN…
            </p>
          ) : null}
          {decode?.valid ? (
            <div className="mt-2 rounded border border-amber-100 bg-white px-3 py-2 text-sm text-foreground">
              <p className="font-mono text-xs text-[var(--status-neutral)]">
                {decode.vin}
              </p>
              {bikeTitle ? (
                <p className="font-medium text-foreground">{bikeTitle}</p>
              ) : null}
              <ul className="mt-1 space-y-0.5 text-[var(--status-neutral)]">
                {decode.fields.vehicleType ? (
                  <li>Type: {decode.fields.vehicleType}</li>
                ) : null}
                {decode.fields.bodyClass ? (
                  <li>Body: {decode.fields.bodyClass}</li>
                ) : null}
                {displacement ? <li>Engine: {displacement}</li> : null}
              </ul>
              {decode.message ? (
                <p className="mt-1 text-amber-800">{decode.message}</p>
              ) : null}
            </div>
          ) : null}
          {decode && !decode.valid ? (
            <p className="mt-2 text-sm text-amber-900">
              VIN could not be fully decoded
              {decode.validationError ? `: ${decode.validationError}` : "."}
            </p>
          ) : null}
          {createHref ? (
            <div className="mt-3">
              <Link href={createHref} className="btn btn-primary">
                Create Motorcycle
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      {conflict ? (
        <div className="mt-3">
          <VinOwnershipConflictNotice
            conflict={conflict}
            currentCustomerName={currentCustomerName}
            pending={pending}
            error={transferError}
            onAccept={acceptTransfer}
            onDecline={clear}
          />
        </div>
      ) : null}
    </div>
  );
}
