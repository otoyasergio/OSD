"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type { AgreementTemplate, DropOffAgreement } from "@/lib/services/contracts";
import { SignatureCanvas } from "@/components/contracts/SignatureCanvas";
import { FormError } from "@/components/forms/Field";
import { formatDateTime } from "@/lib/datetime/format";
import { sanitizeContractHtml } from "@/lib/security/sanitizeHtml";

type Props = {
  template: AgreementTemplate;
  existing: DropOffAgreement | null;
  action: (formData: FormData) => Promise<{ error: string | null }>;
  readOnly?: boolean;
  continueHref?: string;
  continueLabel?: string;
};

export function ContractSigningPanel({
  template,
  existing,
  action,
  readOnly = false,
  continueHref,
  continueLabel = "Continue to work order",
}: Props) {
  const router = useRouter();
  const [signerName, setSignerName] = useState(existing?.signer_name ?? "");
  const [initials, setInitials] = useState<Record<string, string>>(
    existing?.initials ?? {}
  );
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const safeHtml = useMemo(
    () => sanitizeContractHtml(template.body_html),
    [template.body_html]
  );

  if (existing) {
    return (
      <div className="card card-pad flex flex-col gap-3">
        <p className="font-semibold text-emerald-800">Drop-off agreement signed</p>
        <p className="text-sm text-foreground">
          Signed by <strong>{existing.signer_name}</strong> on{" "}
          {formatDateTime(existing.signed_at)} (template {existing.template_version})
        </p>
        {existing.signed_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={existing.signed_url}
            alt="Customer signature"
            className="max-h-32 rounded border border-[var(--border)] bg-white"
          />
        ) : null}
        {continueHref ? (
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
    if (!signature) {
      setError("Draw your signature before submitting.");
      return;
    }

    const formData = new FormData();
    formData.set("signer_name", signerName);
    formData.set("initials", JSON.stringify(initials));
    formData.set("signature_data_url", signature);

    startTransition(async () => {
      const result = await action(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (continueHref) {
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

      {error ? <FormError message={error} /> : null}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary min-h-14 self-start text-lg"
      >
        {pending ? "Saving…" : "Sign drop-off agreement"}
      </button>
    </form>
  );
}
