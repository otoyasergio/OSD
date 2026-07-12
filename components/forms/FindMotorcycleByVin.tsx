"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptVinTransferAction,
  lookupVinInGarageAction,
} from "@/app/(app)/motorcycles/actions";
import type { VinOwnershipConflict } from "@/lib/services/motorcycles";
import { normalizeVin, validateOptionalVin } from "@/lib/vin";
import { VinOwnershipConflictNotice } from "@/components/forms/VinOwnershipConflictNotice";

type Props = {
  customerId: string;
  currentCustomerName?: string;
  onSelectMotorcycle: (motorcycleId: string) => void;
};

export function FindMotorcycleByVin({
  customerId,
  currentCustomerName,
  onSelectMotorcycle,
}: Props) {
  const router = useRouter();
  const [vin, setVin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VinOwnershipConflict | null>(null);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function clear() {
    setVin("");
    setMessage(null);
    setConflict(null);
    setTransferError(null);
  }

  function lookup() {
    setMessage(null);
    setConflict(null);
    setTransferError(null);
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

      setMessage(
        "No motorcycle with that VIN yet. Create one for this customer, or check the number."
      );
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

  return (
    <div className="mt-4 rounded border border-zinc-200 bg-white px-3 py-3">
      <p className="text-sm font-medium text-zinc-800">Find by VIN</p>
      <p className="mt-0.5 text-xs text-zinc-500">
        If this bike already exists for another customer, you can transfer it
        here instead of creating a duplicate.
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

      {message ? (
        <p className="mt-2 text-sm text-zinc-700" role="status">
          {message}
        </p>
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
