"use client";

import {
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import type { MotorcycleDocument } from "@/lib/services/motorcycleDocuments";
import {
  deleteMotorcycleDocumentAction,
  uploadMotorcycleDocumentAction,
} from "@/app/(app)/motorcycles/document-actions";
import { FormError } from "@/components/forms/Field";
import { PhotoLightbox } from "@/components/photos/PhotoLightbox";
import { preparePhotoFileForUpload } from "@/lib/forms/preparePhotoFileForUpload";
import { photoFileInputProps } from "@/lib/forms/photoSourceInputs";
import { formatDate } from "@/lib/datetime/format";
import type { LightboxPhoto } from "@/lib/photos/lightbox";

export function MotorcycleDocuments({
  motorcycleId,
  documents,
  canUpload,
  canDelete,
}: {
  motorcycleId: string;
  documents: MotorcycleDocument[];
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const titleId = useId();
  const cameraInputId = useId();
  const libraryInputId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [chooserOpen, setChooserOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const busy = pending || preparing;
  const imageDocs = documents.filter((doc) => doc.mime_type.startsWith("image/"));
  const lightboxPhotos: LightboxPhoto[] = imageDocs
    .filter((doc) => doc.signed_url)
    .map((doc) => ({
      id: doc.document_id,
      src: doc.signed_url as string,
      label: doc.title,
      caption: formatDate(doc.created_at),
    }));

  useEffect(() => {
    if (!chooserOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setChooserOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [chooserOpen]);

  function refresh() {
    router.refresh();
  }

  async function uploadFromInput(input: HTMLInputElement) {
    const originals = Array.from(input.files ?? []);
    setChooserOpen(false);
    setError(null);
    if (originals.length === 0 || !formRef.current) return;

    setPreparing(true);
    try {
      const files = await Promise.all(
        originals.map((original) =>
          original.type.startsWith("image/")
            ? preparePhotoFileForUpload(original)
            : original
        )
      );
      input.value = "";
      const formData = new FormData(formRef.current);
      formData.delete("file");
      for (const file of files) formData.append("file", file);
      startTransition(() => {
        startPending(async () => {
          const result = await uploadMotorcycleDocumentAction(motorcycleId, formData);
          if (result.error) {
            setError(result.error);
            return;
          }
          setTitle("");
          refresh();
        });
      });
    } catch {
      input.value = "";
      setError("Could not read that photo. Try again, or use the camera instead.");
    } finally {
      setPreparing(false);
    }
  }

  function onDelete(documentId: string, documentTitle: string) {
    if (!confirm(`Delete “${documentTitle}” from this motorcycle profile?`)) {
      return;
    }
    setError(null);
    startPending(async () => {
      const result = await deleteMotorcycleDocumentAction(documentId);
      if (result.error) {
        setError(result.error);
        return;
      }
      refresh();
    });
  }

  const cameraProps = photoFileInputProps("camera");
  const libraryProps = photoFileInputProps("library");

  return (
    <section aria-labelledby={titleId}>
      <h2 id={titleId} className="text-lg font-semibold text-foreground">
        Documents
      </h2>
      <p className="mt-1 text-sm text-[var(--status-neutral)]">
        Registration, ownership, insurance, and other papers for this bike. Kept on the
        profile even after visits close.
      </p>

      <FormError message={error} />

      {documents.length === 0 ? (
        <p className="mt-3 rounded border border-dashed border-[var(--border-strong)] bg-white px-4 py-8 text-center text-sm text-[var(--status-neutral)]">
          No document photos yet. Take a picture of the registration or insurance card to
          keep it with the bike.
        </p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {documents.map((doc) => {
            const imageIndex = imageDocs.findIndex(
              (item) => item.document_id === doc.document_id
            );
            const isImage = doc.mime_type.startsWith("image/");
            return (
              <li
                key={doc.document_id}
                className="overflow-hidden rounded border border-[var(--border)] bg-white"
              >
                {isImage && doc.signed_url ? (
                  <button
                    type="button"
                    className="block aspect-[4/3] w-full bg-[var(--surface-muted)]"
                    onClick={() =>
                      imageIndex >= 0 ? setLightboxIndex(imageIndex) : undefined
                    }
                    aria-label={`View ${doc.title} larger`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed storage URLs */}
                    <img
                      src={doc.signed_url}
                      alt={doc.title}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center bg-[var(--surface-muted)] px-4 text-center text-sm text-[var(--status-neutral)]">
                    PDF document
                  </div>
                )}
                <div className="flex flex-wrap items-start justify-between gap-2 p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{doc.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--status-neutral)]">
                      {formatDate(doc.created_at)}
                      {doc.notes ? ` · ${doc.notes}` : null}
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
                        Open
                      </a>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onDelete(doc.document_id, doc.title)}
                        className="btn btn-secondary min-h-10 text-sm text-red-700"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canUpload ? (
        <form
          ref={formRef}
          className="mt-4 flex flex-col gap-3 rounded border border-[var(--border)] bg-white p-4"
        >
          <p className="text-sm font-medium text-foreground">Add document photo</p>
          <label className="block max-w-md">
            <span className="field-label">Title (optional)</span>
            <input
              type="text"
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
              placeholder="e.g. Registration, ownership, insurance"
            />
          </label>
          <input type="hidden" name="notes" value="" />
          <input
            id={cameraInputId}
            type="file"
            name="file"
            className="sr-only"
            multiple
            {...cameraProps}
            onChange={(e) => void uploadFromInput(e.currentTarget)}
          />
          <input
            id={libraryInputId}
            type="file"
            className="sr-only"
            multiple
            accept={`${libraryProps.accept},application/pdf`}
            onChange={(e) => void uploadFromInput(e.currentTarget)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="btn btn-primary min-h-11"
              onClick={() => setChooserOpen(true)}
            >
              {busy ? "Saving…" : "Take or upload photo"}
            </button>
          </div>
          {chooserOpen ? (
            <div
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
              role="dialog"
              aria-modal="true"
              aria-label="Choose photo source"
              onClick={() => setChooserOpen(false)}
            >
              <div
                className="w-full max-w-sm rounded-lg bg-white p-4 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-sm font-medium text-foreground">Add document photo</p>
                <div className="mt-3 flex flex-col gap-2">
                  <label
                    htmlFor={cameraInputId}
                    className="btn btn-primary min-h-11 cursor-pointer text-center"
                  >
                    Take photo
                  </label>
                  <label
                    htmlFor={libraryInputId}
                    className="btn btn-secondary min-h-11 cursor-pointer text-center"
                  >
                    Choose from library / PDF
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary min-h-11"
                    onClick={() => setChooserOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </form>
      ) : null}

      {lightboxIndex != null && lightboxPhotos.length > 0 ? (
        <PhotoLightbox
          photos={lightboxPhotos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </section>
  );
}
