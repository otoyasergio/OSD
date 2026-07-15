"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AgreementTemplate, DropOffAgreement } from "@/lib/services/contracts";
import { SignatureCanvas } from "@/components/contracts/SignatureCanvas";
import { FormError } from "@/components/forms/Field";
import { formatDateTime } from "@/lib/datetime/format";
import { sanitizeContractHtml } from "@/lib/security/sanitizeHtml";
import { PaperAgreementCopyUpload } from "@/components/contracts/PaperAgreementCopyUpload";

type Props = {
  template: AgreementTemplate;
  existing: DropOffAgreement | null;
  action: (formData: FormData) => Promise<{ error: string | null }>;
  readOnly?: boolean;
  continueHref?: string;
  continueLabel?: string;
  allowPaperSignature?: boolean;
  paperCopyAction?: (formData: FormData) => Promise<{ error: string | null }>;
};

export function ContractSigningPanel({
  template,
  existing,
  action,
  readOnly = false,
  continueHref,
  continueLabel = "Continue to work order",
  allowPaperSignature = false,
  paperCopyAction,
}: Props) {
  const router = useRouter();
  const [signerName, setSignerName] = useState(existing?.signer_name ?? "");
  const [initials, setInitials] = useState<Record<string, string>>(
    existing?.initials ?? {}
  );
  const [signature, setSignature] = useState<string | null>(null);
  const [signedOnPaper, setSignedOnPaper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const safeHtml = useMemo(
    () => sanitizeContractHtml(template.body_html),
    [template.body_html]
  );

  if (existing) {
    const isPaper = existing.signature_method === "paper";
    return (
      <div className="card card-pad flex flex-col gap-3">
        <p className="font-semibold text-emerald-800">
          {isPaper
            ? "Drop-off agreement signed on paper"
            : "Drop-off agreement signed digitally"}
        </p>
        <p className="text-sm text-foreground">
          {isPaper ? (
            <>
              Paper copy recorded on {formatDateTime(existing.signed_at)} (template{" "}
              {existing.template_version})
            </>
          ) : (
            <>
              Signed by <strong>{existing.signer_name}</strong> on{" "}
              {formatDateTime(existing.signed_at)} (template {existing.template_version})
            </>
          )}
        </p>
        {existing.signed_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={existing.signed_url}
            alt="Customer signature"
            className="max-h-32 rounded border border-[var(--border)] bg-white"
          />
        ) : null}
        {isPaper && existing.paper_copy_url ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="flex-1 text-sm font-medium text-emerald-950">
              Signed paper copy uploaded
              {existing.paper_copy_mime_type === "application/pdf" ? " (PDF)" : ""}.
            </p>
            <a
              href={existing.paper_copy_url}
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary min-h-10 text-sm"
            >
              View copy
            </a>
          </div>
        ) : null}
        {isPaper && !existing.paper_copy_url && paperCopyAction && !readOnly ? (
          <PaperAgreementCopyUpload
            action={paperCopyAction}
            continueHref={continueHref}
          />
        ) : null}
        {continueHref &&
        !(isPaper && !existing.paper_copy_url && paperCopyAction && !readOnly) ? (
          <Link href={continueHref} className="btn btn-primary min-h-12 self-start">
            {continueLabel}
          </Link>
        ) : null}
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">No signed agreement</p>
        <p className="empty-state-desc">
          Switch to this location to capture a signature.
        </p>
      </div>
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!signedOnPaper && !signature) {
      setError("Draw your signature before submitting.");
      return;
    }

    const formData = new FormData();
    if (signedOnPaper) {
      formData.set("signature_method", "paper");
    } else {
      formData.set("signature_method", "digital");
      formData.set("signer_name", signerName);
      formData.set("initials", JSON.stringify(initials));
      formData.set("signature_data_url", signature!);
    }

    startTransition(async () => {
      const result = await action(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (continueHref && !signedOnPaper) {
        router.push(continueHref);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="contract-signing-form flex flex-col gap-6">
      <div
        className="contract-signing-prose prose prose-sm max-w-none rounded border border-[var(--border)] bg-white p-4"
        dangerouslySetInnerHTML={{ __html: safeHtml }}
      />

      {allowPaperSignature ? (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-white p-4">
          <input
            type="checkbox"
            role="switch"
            className="sr-only"
            checked={signedOnPaper}
            disabled={pending}
            onChange={(event) => {
              setSignedOnPaper(event.target.checked);
              setError(null);
            }}
          />
          <span
            aria-hidden
            className={`relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors ${
              signedOnPaper ? "bg-emerald-600" : "bg-zinc-300"
            }`}
          >
            <span
              className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                signedOnPaper ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </span>
          <span className="flex flex-col">
            <span className="font-semibold text-foreground">Signed by paper</span>
            <span className="text-sm text-[var(--status-neutral)]">
              Turn this on when the physical agreement has been signed and kept on file.
            </span>
          </span>
        </label>
      ) : null}

      {signedOnPaper ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
          Saving will mark this agreement as signed on paper. No digital signature is
          required. After saving, you can photograph or upload the paper copy.
        </div>
      ) : (
        <>
          {template.initial_fields.map((field) => (
            <label key={field} className="block w-full max-w-md">
              <span className="field-label capitalize">Initial — {field}</span>
              <input
                type="text"
                maxLength={8}
                required
                value={initials[field] ?? ""}
                onChange={(e) =>
                  setInitials((prev) => ({ ...prev, [field]: e.target.value }))
                }
                className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3 text-lg uppercase tracking-widest"
                autoComplete="off"
              />
            </label>
          ))}

          <label className="block max-w-md">
            <span className="field-label">Full legal name</span>
            <input
              type="text"
              required
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              className="min-h-11 w-full rounded border border-[var(--border-strong)] px-3"
            />
          </label>

          <div>
            <span className="field-label">Signature</span>
            <SignatureCanvas onChange={setSignature} height={200} />
          </div>
        </>
      )}

      {error ? <FormError message={error} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary min-h-14 text-lg"
        >
          {pending
            ? "Saving…"
            : signedOnPaper
              ? "Save paper signature"
              : "Sign drop-off agreement"}
        </button>
        {continueHref ? (
          <Link href={continueHref} className="btn btn-secondary min-h-14 text-lg">
            Continue without signing
          </Link>
        ) : null}
      </div>
      {continueHref ? (
        <p className="text-sm text-[var(--status-neutral)]">
          The signature is optional and can be collected later from the work order.
        </p>
      ) : null}
    </form>
  );
}
