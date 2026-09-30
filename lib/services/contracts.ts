import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canManageContractTemplate, canSignContract } from "@/lib/permissions";
import { fileDropOffAgreementDocument } from "@/lib/services/customerDocuments";
import {
  dropOffAgreementSchema,
  publishAgreementTemplateSchema,
} from "@/lib/validation/schemas";
import { sanitizeContractHtml } from "@/lib/security/sanitizeHtml";

export type AgreementTemplate = {
  template_id: string;
  version: string;
  title: string;
  body_html: string;
  initial_fields: string[];
};

export type AgreementTemplateSummary = {
  template_id: string;
  version: string;
  title: string;
  active: boolean;
  created_at: string;
};

export type DropOffAgreement = {
  agreement_id: string;
  work_order_id: string;
  template_version: string;
  signer_name: string;
  initials: Record<string, string>;
  signature_method: "digital" | "paper";
  signature_storage_path: string | null;
  signed_at: string;
  signed_url?: string | null;
  paper_copy_url?: string | null;
  paper_copy_mime_type?: string | null;
};

const BUCKET = "contract-signatures";
const SIGNATURE_MAX_BYTES = 2 * 1024 * 1024;
const AGREEMENT_COLUMNS =
  "agreement_id, work_order_id, template_version, signer_name, initials, signature_method, signature_storage_path, signed_at";

export async function getActiveAgreementTemplate(): Promise<AgreementTemplate | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drop_off_agreement_template")
    .select("template_id, version, title, body_html, initial_fields")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    initial_fields: (data.initial_fields as string[]) ?? [],
  };
}

export async function listAgreementTemplates(): Promise<AgreementTemplateSummary[]> {
  const user = await requireUser();
  if (!canManageContractTemplate(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drop_off_agreement_template")
    .select("template_id, version, title, active, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw error;
  return data ?? [];
}

function defaultTemplateVersion(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveTemplateVersion(
  supabase: DbClient,
  requested?: string
): Promise<string> {
  const base = requested?.trim() || defaultTemplateVersion();
  let candidate = base;
  let suffix = 1;

  while (true) {
    const { data, error } = await supabase
      .from("drop_off_agreement_template")
      .select("template_id")
      .eq("version", candidate)
      .maybeSingle();

    if (error) throw error;
    if (!data) return candidate;

    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

export async function publishAgreementTemplate(input: {
  title: string;
  body_html: string;
  initial_fields: string[];
  version?: string;
}): Promise<AgreementTemplate> {
  const user = await requireUser();
  if (!canManageContractTemplate(user.role)) throw new Error("FORBIDDEN");

  const parsed = publishAgreementTemplateSchema.parse(input);
  const supabase = await createClient();
  const version = await resolveTemplateVersion(supabase, parsed.version);

  const { error: deactivateError } = await supabase
    .from("drop_off_agreement_template")
    .update({ active: false })
    .eq("active", true);

  if (deactivateError) throw deactivateError;

  const { data, error } = await supabase
    .from("drop_off_agreement_template")
    .insert({
      version,
      title: parsed.title,
      body_html: sanitizeContractHtml(parsed.body_html),
      initial_fields: parsed.initial_fields,
      active: true,
    })
    .select("template_id, version, title, body_html, initial_fields")
    .single();

  if (error) throw error;

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    action: "drop_off_agreement_template_published",
    entity_type: "drop_off_agreement_template",
    entity_id: data.template_id,
    description: `Published drop-off agreement template ${version}`,
    new_value: {
      version,
      title: parsed.title,
      initial_fields: parsed.initial_fields,
    },
  });

  return {
    ...data,
    initial_fields: (data.initial_fields as string[]) ?? [],
  };
}

export async function getDropOffAgreement(
  workOrderId: string
): Promise<DropOffAgreement | null> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drop_off_agreement")
    .select(AGREEMENT_COLUMNS)
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const agreement = {
    ...data,
    initials: (data.initials as Record<string, string>) ?? {},
  };

  const signed = agreement.signature_storage_path
    ? await supabase.storage
        .from(BUCKET)
        .createSignedUrl(agreement.signature_storage_path, 3600)
    : { data: null };

  let paperCopyUrl: string | null = null;
  let paperCopyMimeType: string | null = null;
  if (agreement.signature_method === "paper") {
    const { data: paperCopy, error: paperCopyError } = await supabase
      .from("customer_document")
      .select("storage_bucket, storage_path, mime_type")
      .eq("agreement_id", agreement.agreement_id)
      .maybeSingle();

    if (paperCopyError) throw paperCopyError;
    if (paperCopy) {
      const { data: paperCopySigned } = await supabase.storage
        .from(paperCopy.storage_bucket)
        .createSignedUrl(paperCopy.storage_path, 3600);
      paperCopyUrl = paperCopySigned?.signedUrl ?? null;
      paperCopyMimeType = paperCopy.mime_type;
    }
  }

  return {
    ...agreement,
    signed_url: signed.data?.signedUrl ?? null,
    paper_copy_url: paperCopyUrl,
    paper_copy_mime_type: paperCopyMimeType,
  };
}

export async function signDropOffAgreement(
  workOrderId: string,
  input: {
    signer_name: string;
    initials: Record<string, string>;
    signature_data_url: string;
    ip_address?: string | null;
    user_agent?: string | null;
  }
): Promise<DropOffAgreement> {
  const user = await requireUser();
  if (!canSignContract(user.role)) throw new Error("FORBIDDEN");

  const parsed = dropOffAgreementSchema.parse(input);
  const template = await getActiveAgreementTemplate();
  if (!template) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");

  for (const field of template.initial_fields) {
    if (!parsed.initials[field]?.trim()) {
      throw new Error("CONTRACT_INITIALS_REQUIRED");
    }
  }

  const supabase = await createClient();
  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select("work_order_id, customer_id, location_id, work_order_number, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }

  const existing = await getDropOffAgreement(workOrderId);
  if (existing) throw new Error("CONTRACT_ALREADY_SIGNED");

  const match = parsed.signature_data_url.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) throw new Error("SIGNATURE_INVALID");

  const ext = match[1] === "jpeg" ? "jpg" : "png";
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > SIGNATURE_MAX_BYTES) throw new Error("SIGNATURE_TOO_LARGE");

  const agreementId = crypto.randomUUID();
  const storagePath = `${workOrderId}/${agreementId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: `image/${match[1]}`,
      upsert: false,
    });

  if (uploadError) throw new Error("SIGNATURE_UPLOAD_FAILED");

  const { data, error } = await supabase
    .from("drop_off_agreement")
    .insert({
      agreement_id: agreementId,
      work_order_id: workOrderId,
      template_id: template.template_id,
      template_version: template.version,
      signer_name: parsed.signer_name,
      initials: parsed.initials,
      signature_method: "digital",
      signature_storage_path: storagePath,
      signed_by_user_id: user.user_id,
      ip_address: parsed.ip_address ?? null,
      user_agent: parsed.user_agent ?? null,
    })
    .select(AGREEMENT_COLUMNS)
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.DROP_OFF_AGREEMENT_SIGNED,
    entity_type: "drop_off_agreement",
    entity_id: agreementId,
    description: `Drop-off agreement signed by ${parsed.signer_name}`,
    new_value: { template_version: template.version, signer_name: parsed.signer_name },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "drop_off_agreement_signed",
    entity_type: "drop_off_agreement",
    entity_id: agreementId,
    description: `Drop-off agreement signed on ${workOrder.work_order_number}`,
    new_value: { signer_name: parsed.signer_name },
  });

  await fileDropOffAgreementDocument(supabase, {
    customer_id: workOrder.customer_id,
    work_order_id: workOrderId,
    work_order_number: workOrder.work_order_number,
    agreement_id: agreementId,
    signature_storage_path: storagePath,
    signed_at: (data as DropOffAgreement).signed_at,
    uploaded_by_user_id: user.user_id,
  });

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  return {
    ...(data as DropOffAgreement),
    initials: parsed.initials,
    signed_url: signed?.signedUrl ?? null,
  };
}

export async function markDropOffAgreementSignedOnPaper(
  workOrderId: string,
  input: {
    ip_address?: string | null;
    user_agent?: string | null;
  } = {}
): Promise<DropOffAgreement> {
  const user = await requireUser();
  if (!canSignContract(user.role)) throw new Error("FORBIDDEN");

  const template = await getActiveAgreementTemplate();
  if (!template) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");

  const supabase = await createClient();
  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .select("work_order_id, location_id, work_order_number, status")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  if (workOrder.status === "completed" || workOrder.status === "cancelled") {
    throw new Error("WORK_ORDER_LOCKED");
  }

  const existing = await getDropOffAgreement(workOrderId);
  if (existing) throw new Error("CONTRACT_ALREADY_SIGNED");

  const agreementId = crypto.randomUUID();
  const { data, error } = await supabase
    .from("drop_off_agreement")
    .insert({
      agreement_id: agreementId,
      work_order_id: workOrderId,
      template_id: template.template_id,
      template_version: template.version,
      signer_name: "Paper copy",
      initials: {},
      signature_method: "paper",
      signature_storage_path: null,
      signed_by_user_id: user.user_id,
      ip_address: input.ip_address ?? null,
      user_agent: input.user_agent ?? null,
    })
    .select(AGREEMENT_COLUMNS)
    .single();

  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.DROP_OFF_AGREEMENT_SIGNED,
    entity_type: "drop_off_agreement",
    entity_id: agreementId,
    description: "Drop-off agreement marked signed on paper",
    new_value: { template_version: template.version, signature_method: "paper" },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "drop_off_agreement_signed",
    entity_type: "drop_off_agreement",
    entity_id: agreementId,
    description: `Paper drop-off agreement recorded on ${workOrder.work_order_number}`,
    new_value: { signature_method: "paper" },
  });

  return {
    ...(data as DropOffAgreement),
    initials: {},
    signed_url: null,
  };
}

export async function hasSignedDropOffAgreement(workOrderId: string): Promise<boolean> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("drop_off_agreement")
    .select("agreement_id")
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  return data != null;
}
