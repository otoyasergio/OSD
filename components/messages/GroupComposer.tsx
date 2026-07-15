"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DirectoryStaff } from "@/lib/services/directory";
import { DirectoryList } from "@/components/messages/DirectoryList";
import { createGroupAction } from "@/app/(app)/messages/actions";

type Props = {
  atLocation: DirectoryStaff[];
  allCompany: DirectoryStaff[];
};

export function GroupComposer({ atLocation, allCompany }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(userId: string) {
    setSelected((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="field-label" htmlFor="group-title">
          Group name
        </label>
        <input
          id="group-title"
          className="input w-full"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Shop floor"
        />
      </div>
      <p className="text-sm text-slate-500">
        Select at least one person to include in the group.
      </p>
      <DirectoryList
        atLocation={atLocation}
        allCompany={allCompany}
        multiSelect
        selectedIds={selected}
        onToggleSelect={toggle}
      />
      {error ? <p className="text-sm text-[var(--status-danger-fg)]">{error}</p> : null}
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending || selected.length === 0}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await createGroupAction(title, selected);
            if (result.error || !result.conversationId) {
              setError(result.error ?? "Could not create group.");
              return;
            }
            router.push(`/messages/${result.conversationId}`);
          });
        }}
      >
        Create group
      </button>
    </div>
  );
}
