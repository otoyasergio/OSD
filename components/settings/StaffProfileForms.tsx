"use client";

import { useActionState } from "react";
import type { StaffFormState } from "@/app/(app)/settings/staff/[user_id]/actions";
import type {
  StaffDocument,
  StaffEmploymentRecord,
  StaffNote,
} from "@/lib/services/staffProfiles";
import {
  STAFF_DOCUMENT_CATEGORY_LABELS,
  type StaffDocumentCategory,
} from "@/lib/services/staffDocumentRetention";
import { FormError, TextAreaField, TextField } from "@/components/forms/Field";
import { SubmitButton } from "@/components/forms/SubmitButton";

type Action = (state: StaffFormState, formData: FormData) => Promise<StaffFormState>;

const SELECT_CLASS =
  "min-h-11 w-full rounded border border-[var(--border-strong)] bg-white px-3 py-2 text-base text-foreground outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-ring)]";

type Props = {
  hasPin: boolean;
  employment: StaffEmploymentRecord | null;
  notes: StaffNote[];
  documents: StaffDocument[];
  categories: Array<{
    value: StaffDocumentCategory;
    label: string;
    retentionHint: string;
  }>;
  updateEmploymentAction: Action;
  setPinAction: Action;
  clearPinAction: () => Promise<void>;
  addNoteAction: Action;
  voidNoteAction: (noteId: string) => Promise<void>;
  uploadDocumentAction: Action;
  voidDocumentAction: (documentId: string) => Promise<void>;
};

function SuccessMessage({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      {message}
    </p>
  );
}

export function StaffProfileForms({
  hasPin,
  employment,
  notes,
  documents,
  categories,
  updateEmploymentAction,
  setPinAction,
  clearPinAction,
  addNoteAction,
  voidNoteAction,
  uploadDocumentAction,
  voidDocumentAction,
}: Props) {
  const [employmentState, employmentFormAction] = useActionState(updateEmploymentAction, {
    error: null,
  });
  const [pinState, pinFormAction] = useActionState(setPinAction, { error: null });
  const [noteState, noteFormAction] = useActionState(addNoteAction, { error: null });
  const [docState, docFormAction] = useActionState(uploadDocumentAction, { error: null });

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold text-foreground">Time clock PIN</h2>
        <p className="text-sm text-[var(--status-neutral)]">
          4-digit PIN for the tablet kiosk. Must be unique among active staff.
          {hasPin ? " A PIN is currently set." : " No PIN set yet."}
        </p>
        <form action={pinFormAction} className="flex flex-col gap-3 sm:max-w-xs">
          <FormError message={pinState.error} />
          <SuccessMessage message={pinState.success} />
          <TextField
            label="New PIN"
            name="pin"
            inputMode="numeric"
            autoComplete="off"
            required
            maxLength={4}
            minLength={4}
            placeholder="####"
          />
          <SubmitButton label="Save PIN" pendingLabel="Saving…" />
        </form>
        {hasPin ? (
          <form action={clearPinAction}>
            <button
              type="submit"
              className="text-sm text-red-800 underline-offset-2 hover:underline"
            >
              Clear PIN
            </button>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold text-foreground">Employment record</h2>
        <form action={employmentFormAction} className="flex flex-col gap-3">
          <FormError message={employmentState.error} />
          <SuccessMessage message={employmentState.success} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label="Legal name"
              name="legal_name"
              defaultValue={employment?.legal_name}
            />
            <TextField
              label="Job title"
              name="job_title"
              defaultValue={employment?.job_title}
            />
            <TextField
              label="Employment start"
              name="employment_start_date"
              type="date"
              defaultValue={employment?.employment_start_date}
            />
            <TextField
              label="Employment end"
              name="employment_end_date"
              type="date"
              defaultValue={employment?.employment_end_date}
            />
            <TextField
              label="Date of birth"
              name="date_of_birth"
              type="date"
              defaultValue={employment?.date_of_birth}
            />
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">
                Pay type
              </span>
              <select
                className={SELECT_CLASS}
                name="pay_type"
                defaultValue={employment?.pay_type ?? ""}
              >
                <option value="">—</option>
                <option value="hourly">Hourly</option>
                <option value="salary">Salary</option>
              </select>
            </label>
            <TextField
              label="Regular day hours"
              name="regular_work_day_hours"
              type="number"
              defaultValue={employment?.regular_work_day_hours}
            />
            <TextField
              label="Regular week hours"
              name="regular_work_week_hours"
              type="number"
              defaultValue={employment?.regular_work_week_hours}
            />
            <TextField
              label="Emergency contact"
              name="emergency_contact_name"
              defaultValue={employment?.emergency_contact_name}
            />
            <TextField
              label="Emergency phone"
              name="emergency_contact_phone"
              type="tel"
              defaultValue={employment?.emergency_contact_phone}
            />
          </div>
          <TextAreaField
            label="Home address"
            name="home_address"
            defaultValue={employment?.home_address}
          />
          <div>
            <SubmitButton label="Save employment" pendingLabel="Saving…" />
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold text-foreground">Notes</h2>
        <form action={noteFormAction} className="flex flex-col gap-3">
          <FormError message={noteState.error} />
          <SuccessMessage message={noteState.success} />
          <TextAreaField label="New note" name="body" required />
          <div>
            <SubmitButton label="Add note" pendingLabel="Saving…" />
          </div>
        </form>
        <ul className="divide-y divide-[var(--border)]">
          {notes.length === 0 ? (
            <li className="py-3 text-sm text-[var(--status-neutral)]">No notes yet.</li>
          ) : (
            notes.map((note) => (
              <li
                key={note.note_id}
                className="flex items-start justify-between gap-3 py-3"
              >
                <div>
                  <p className="whitespace-pre-wrap text-sm text-foreground">
                    {note.body}
                  </p>
                  <p className="mt-1 text-xs text-[var(--status-neutral)]">
                    {new Date(note.created_at).toLocaleString()}
                  </p>
                </div>
                <form action={voidNoteAction.bind(null, note.note_id)}>
                  <button
                    type="submit"
                    className="text-xs text-red-800 underline-offset-2 hover:underline"
                  >
                    Void
                  </button>
                </form>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4">
        <h2 className="font-semibold text-foreground">Documents</h2>
        <form action={docFormAction} className="flex flex-col gap-3">
          <FormError message={docState.error} />
          <SuccessMessage message={docState.success} />
          <TextField label="Title" name="title" required />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">
              Category
            </span>
            <select
              className={SELECT_CLASS}
              name="category"
              required
              defaultValue="other"
            >
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
            <span className="field-hint mt-1 block">
              Retention guidance is applied automatically from the category.
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-foreground">File</span>
            <input
              type="file"
              name="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="block w-full text-sm"
            />
          </label>
          <div>
            <SubmitButton label="Upload document" pendingLabel="Uploading…" />
          </div>
        </form>
        <ul className="divide-y divide-[var(--border)]">
          {documents.length === 0 ? (
            <li className="py-3 text-sm text-[var(--status-neutral)]">
              No documents yet.
            </li>
          ) : (
            documents.map((doc) => (
              <li
                key={doc.document_id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div>
                  <p className="font-medium text-foreground">{doc.title}</p>
                  <p className="text-sm text-[var(--status-neutral)]">
                    {STAFF_DOCUMENT_CATEGORY_LABELS[doc.category] ?? doc.category}
                    {doc.retention_until ? ` · Retain until ${doc.retention_until}` : ""}
                  </p>
                  {doc.signed_url ? (
                    <a
                      href={doc.signed_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[var(--accent)] underline-offset-2 hover:underline"
                    >
                      Open
                    </a>
                  ) : null}
                </div>
                <form action={voidDocumentAction.bind(null, doc.document_id)}>
                  <button
                    type="submit"
                    className="text-xs text-red-800 underline-offset-2 hover:underline"
                  >
                    Void
                  </button>
                </form>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
