"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setActiveLocation } from "@/app/(app)/actions/set-location";

export type LocationOption = {
  location_id: string;
  name: string;
  code: string;
};

type Props = {
  locations: LocationOption[];
  activeLocationId: string;
};

export function LocationSwitcher({ locations, activeLocationId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const locationId = event.target.value;
    if (!locationId || locationId === activeLocationId) return;

    startTransition(async () => {
      await setActiveLocation(locationId);
      router.refresh();
    });
  }

  if (locations.length === 0) return null;

  return (
    <label className="flex items-center gap-2 text-sm text-zinc-300">
      <span className="whitespace-nowrap font-medium">Location</span>
      <select
        value={activeLocationId}
        onChange={onChange}
        disabled={pending || locations.length === 1}
        className="min-h-11 min-w-[10rem] rounded border border-zinc-700 bg-zinc-900 px-2 text-base text-white"
        aria-label="Active location"
      >
        {locations.map((loc) => (
          <option key={loc.location_id} value={loc.location_id}>
            {loc.name} ({loc.code})
          </option>
        ))}
      </select>
    </label>
  );
}
