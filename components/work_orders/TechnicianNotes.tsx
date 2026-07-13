"use client";

import { useActionState, useMemo, useState } from "react";
import type { TechnicianNote } from "@/lib/services/notes";
import type { WorkOrderJob } from "@/lib/services/workOrders";
import type { NoteFormState } from "@/app/(app)/work_orders/note-actions";
import type { TechnicianNoteType } from "@/lib/database/types";
import { TECHNICIAN_NOTE_TYPE_LABELS } from "@/lib/status/labels";
import { FormError, TextAreaField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";
import { formatDateTime } from "@/lib/datetime/format";

type Action = (state: NoteFormState, formData: FormData) => Promise<NoteFormState>;

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

const NOTE_TYPES = Object.keys(TECHNICIAN_NOTE_TYPE_LABELS) as TechnicianNoteType[];

export function TechnicianNotes({
  notes,
  jobs,
  readOnly,
  canAdd,
  addAction,
}: {
  notes: TechnicianNote[];
  jobs: WorkOrderJob[];
  readOnly: boolean;
  canAdd: boolean;
  addAction: Action;
}) {
  const [addState, addFormAction] = useActionState(addAction, { error: null });
  const [jobFilter, setJobFilter] = useState<string>("all");

  const visible = useMemo(() => {
    if (jobFilter === "all") return notes;
    if (jobFilter === "none") return notes.filter((n) => !n.job_id);
    return notes.filter((n) => n.job_id === jobFilter);
  }, [notes, jobFilter]);

  return (
    <div className="flex flex-col gap-4">
      {!readOnly && canAdd ? (
        <form
          action={addFormAction}
          className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
        >
          <h3 className="text-base font-semibold text-foreground">Add technician note</h3>
          <p className="text-xs text-[var(--status-neutral)]">
            Notes are append-only. They cannot be edited or deleted.
          </p>
          <FormError message={addState.error} />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">Type</span>
            <select className={SELECT_CLASS} name="note_type" defaultValue="general">
              {NOTE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TECHNICIAN_NOTE_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Related job (optional)
            </span>
            <select className={SELECT_CLASS} name="job_id" defaultValue="">
              <option value="">Work order (no job)</option>
              {jobs.map((job) => (
                <option key={job.job_id} value={job.job_id}>
                  {job.service_name_snapshot}
                </option>
              ))}
            </select>
          </label>
          <TextAreaField label="Note" name="note" rows={4} />
          <div>
            <SubmitButton label="Add note" pendingLabel="Saving…" />
          </div>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-foreground" htmlFor="note-job-filter">
          Filter by job
        </label>
        <select
          id="note-job-filter"
          className={`${SELECT_CLASS} w-auto min-w-48`}
          value={jobFilter}
          onChange={(e) => setJobFilter(e.target.value)}
        >
          <option value="all">All notes</option>
          <option value="none">Work order only</option>
          {jobs.map((job) => (
            <option key={job.job_id} value={job.job_id}>
              {job.service_name_snapshot}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 ? (
        <p className="rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-10 text-center text-[var(--status-neutral)]">
          No technician notes yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((note) => (
            <li
              key={note.technician_note_id}
              className="rounded border border-[var(--border)] bg-white p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  {TECHNICIAN_NOTE_TYPE_LABELS[note.note_type] ?? note.note_type}
                </p>
                <p className="text-xs text-[var(--status-neutral)]">
                  {formatDateTime(note.created_at)}
                  {note.created_by
                    ? ` · ${note.created_by.first_name} ${note.created_by.last_name}`
                    : ""}
                </p>
              </div>
              {note.job ? (
                <p className="mt-1 text-xs text-[var(--status-neutral)]">
                  Job: {note.job.service_name_snapshot}
                </p>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {note.note}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
