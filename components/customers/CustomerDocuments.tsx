"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { CustomerDocument } from "@/lib/services/customerDocuments";
import {
  deleteCustomerDocumentAction,
  uploadCustomerDocumentAction,
} from "@/app/(app)/customers/document-actions";
import { FormError } from "@/components/forms/Field";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function sourceLabel(source: CustomerDocument["source"]) {
  return source === "drop_off_agreement" ? "Drop-off agreement" : "Upload";
}

export function CustomerDocuments({
  customerId,
  documents,
  canUpload,
  canDelete,
}: {
  customerId: string;
  documents: CustomerDocument[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function refresh() {
    router.refresh();
  }

  function onUpload(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!file) {
      setError("Choose a file to upload.");
      return;
    }

    const formData = new FormData();
    formData.set("title", title);
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadCustomerDocumentAction(customerId, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setTitle("");
      setFile(null);
      refresh();
    });
  }

  function onDelete(documentId: string, documentTitle: string) {
    if (!confirm(`Delete “${documentTitle}” from this customer profile?`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteCustomerDocumentAction(documentId);
      if (result.error) {
        setError(result.error);
        return;
      }
      refresh();
    });
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-zinc-900">Documents</h2>
      <p className="mt-1 text-sm text-zinc-600">
        Signed drop-off agreements and uploaded files for this customer.
      </p>

      <FormError message={error} />

      {documents.length === 0 ? (
        <p className="mt-3 rounded border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600">
          No documents on file yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
          {documents.map((doc) => (
            <li
              key={doc.document_id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-medium text-zinc-900">{doc.title}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {sourceLabel(doc.source)} · {formatDate(doc.created_at)}
                  {doc.work_order_id && doc.work_order_number ? (
                    <>
                      {" · "}
                      <Link
                        href={`/work_orders/${doc.work_order_id}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {doc.work_order_number}
                      </Link>
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {doc.signed_url ? (
                  <a
                    href={doc.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary min-h-10 text-sm"
                  >
                    View
                  </a>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => onDelete(doc.document_id, doc.title)}
                    className="btn btn-secondary min-h-10 text-sm text-red-700"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {canUpload ? (
        <form
          onSubmit={onUpload}
          className="mt-4 flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4"
        >
          <p className="text-sm font-medium text-zinc-900">Upload document</p>
          <label className="block max-w-md">
            <span className="field-label">Title</span>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-11 w-full rounded border border-zinc-300 px-3"
              placeholder="e.g. Insurance card"
            />
          </label>
          <label className="block max-w-md">
            <span className="field-label">File (PDF, JPEG, PNG, WebP)</span>
            <input
              type="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary min-h-11 self-start"
          >
            {pending ? "Saving…" : "Upload"}
          </button>
        </form>
      ) : null}
    </section>
  );
}
