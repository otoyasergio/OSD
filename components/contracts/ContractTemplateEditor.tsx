"use client";

import { useActionState, useState } from "react";
import type { AgreementTemplate, AgreementTemplateSummary } from "@/lib/services/contracts";
import type { ContractTemplateFormState } from "@/app/(app)/settings/contract_template/actions";
import { FormError } from "@/components/forms/Field";
import { formatDateTime } from "@/lib/datetime/format";

type Props = {
  template: AgreementTemplate | null;
  history: AgreementTemplateSummary[];
  action: (
    prevState: ContractTemplateFormState,
    formData: FormData
  ) => Promise<ContractTemplateFormState>;
};

const initialState: ContractTemplateFormState = { error: null };

export function ContractTemplateEditor({ template, history, action }: Props) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [title, setTitle] = useState(template?.title ?? "");
  const [bodyHtml, setBodyHtml] = useState(template?.body_html ?? "");
  const [initialFields, setInitialFields] = useState(
    (template?.initial_fields ?? []).join(", ")
  );

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-zinc-600">
        Saving publishes a new version. Signed contracts keep the text from the version
        they were signed under.
      </p>

      <form action={formAction} className="flex flex-col gap-6">
        <label className="block max-w-xl">
          <span className="field-label">Title</span>
          <input
            type="text"
            name="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="min-h-11 w-full rounded border border-zinc-300 px-3"
          />
        </label>

        <label className="block max-w-xl">
          <span className="field-label">Version (optional)</span>
          <input
            type="text"
            name="version"
            placeholder="Auto-generated from today&apos;s date if blank"
            className="min-h-11 w-full rounded border border-zinc-300 px-3"
          />
          <span className="mt-1 block text-xs text-zinc-500">
            Leave blank to use today&apos;s date. A suffix is added if that version already
            exists.
          </span>
        </label>

        <label className="block">
          <span className="field-label">Initial field keys</span>
          <input
            type="text"
            name="initial_fields"
            required
            value={initialFields}
            onChange={(e) => setInitialFields(e.target.value)}
            placeholder="liability, authorization, parts, condition, pickup"
            className="min-h-11 w-full rounded border border-zinc-300 px-3"
          />
          <span className="mt-1 block text-xs text-zinc-500">
            Comma-separated keys. Each must match a{" "}
            <code className="text-xs">data-initial=&quot;key&quot;</code> section in the HTML
            below.
          </span>
        </label>

        <div className="grid gap-6 lg:grid-cols-2">
          <label className="block">
            <span className="field-label">Contract HTML</span>
            <textarea
              name="body_html"
              required
              rows={24}
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
            />
          </label>

          <div>
            <span className="field-label">Preview</span>
            <div
              className="prose prose-sm max-h-[36rem] max-w-none overflow-y-auto rounded border border-zinc-200 bg-white p-4"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </div>
        </div>

        {state.error ? <FormError message={state.error} /> : null}
        {state.success ? (
          <p className="text-sm font-medium text-emerald-800">
            Contract template published.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary min-h-11 self-start"
        >
          {pending ? "Publishing…" : "Publish new version"}
        </button>
      </form>

      {history.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Version history
          </h2>
          <div className="divide-y divide-zinc-100 rounded border border-zinc-200 bg-white">
            {history.map((item) => (
              <div
                key={item.template_id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <div>
                  <span className="font-medium text-zinc-900">{item.title}</span>
                  <span className="ml-2 text-zinc-600">v{item.version}</span>
                  {item.active ? (
                    <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      Active
                    </span>
                  ) : null}
                </div>
                <span className="text-zinc-500">
                  {formatDateTime(item.created_at)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
