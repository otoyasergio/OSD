import { createAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import { requireUser } from "@/lib/auth/session";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { generatePortalToken, hashPortalToken } from "@/lib/portal/tokens";
import { fileDropOffAgreementDocument } from "@/lib/services/customerDocuments";

export type PortalTokenPurpose =
  | "full"
  | "estimate"
  | "payment"
  | "inspection"
  | "contract";

export type PortalSession = {
  token_id: string;
  work_order_id: string;
  purpose: PortalTokenPurpose;
  expires_at: string;
};

export type PortalWorkOrderView = {
  work_order_id: string;
  work_order_number: string;
  status: string;
  customer: { first_name: string; last_name: string };
  motorcycle: { year: number; make: string; model: string };
  jobs: {
    job_id: string;
    name_snapshot: string;
    status: string;
    standard_price_snapshot: number | null;
    require_approval: boolean; // derived: status === waiting_for_approval
  }[];
  parts: {
    part_name: string;
    quantity: number;
    unit_price: number | null;
    job_name: string;
  }[];
  square_invoice_id: string | null;
  square_payment_status: string | null;
  inspection_completed: boolean;
  has_signed_contract: boolean;
  has_inspection_ack: boolean;
};

export async function createPortalToken(input: {
  workOrderId: string;
  purpose?: PortalTokenPurpose;
  expiresInDays?: number;
}): Promise<{ token: string; expires_at: string }> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: wo, error } = await supabase
    .from("work_order")
    .select("work_order_id, location_id")
    .eq("work_order_id", input.workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!wo) throw new Error("WORK_ORDER_NOT_FOUND");
  if (wo.location_id !== user.active_location_id) throw new Error("FOREIGN_LOCATION");

  const { token, hash } = generatePortalToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays ?? 7));

  const { error: insertError } = await supabase.from("customer_portal_token").insert({
    work_order_id: input.workOrderId,
    token_hash: hash,
    purpose: input.purpose ?? "full",
    expires_at: expiresAt.toISOString(),
    created_by_user_id: user.user_id,
  });

  if (insertError) throw insertError;

  return { token, expires_at: expiresAt.toISOString() };
}

async function resolvePortalSession(token: string): Promise<PortalSession> {
  const admin = createAdminClient();
  const hash = hashPortalToken(token);

  const { data, error } = await admin
    .from("customer_portal_token")
    .select("token_id, work_order_id, purpose, expires_at, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();

  if (error) throw error;
  if (!data || data.revoked_at) throw new Error("PORTAL_TOKEN_INVALID");
  if (new Date(data.expires_at) < new Date()) throw new Error("PORTAL_TOKEN_EXPIRED");

  await admin
    .from("customer_portal_token")
    .update({ last_accessed_at: new Date().toISOString() })
    .eq("token_id", data.token_id);

  return {
    token_id: data.token_id,
    work_order_id: data.work_order_id,
    purpose: data.purpose as PortalTokenPurpose,
    expires_at: data.expires_at,
  };
}

export async function getPortalWorkOrder(token: string): Promise<PortalWorkOrderView> {
  const session = await resolvePortalSession(token);
  const admin = createAdminClient();

  const { data: wo, error } = await admin
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      status,
      square_invoice_id,
      square_payment_status,
      customer:customer_id ( first_name, last_name ),
      motorcycle:motorcycle_id ( year, make, model )
    `
    )
    .eq("work_order_id", session.work_order_id)
    .maybeSingle();

  if (error) throw error;
  if (!wo) throw new Error("WORK_ORDER_NOT_FOUND");

  const { data: jobRows } = await admin
    .from("job")
    .select("job_id, service_name_snapshot, status, standard_price_snapshot")
    .eq("work_order_id", session.work_order_id)
    .not("status", "eq", "cancelled");

  const jobs: PortalWorkOrderView["jobs"] = (jobRows ?? []).map((j) => ({
    job_id: j.job_id,
    name_snapshot: j.service_name_snapshot,
    status: j.status,
    standard_price_snapshot: j.standard_price_snapshot,
    require_approval: j.status === "waiting_for_approval",
  }));

  const jobIds = jobs.map((j) => j.job_id);
  let parts: PortalWorkOrderView["parts"] = [];

  if (jobIds.length > 0) {
    const { data: partRows } = await admin
      .from("part")
      .select("part_name, quantity, unit_price, job_id")
      .in("job_id", jobIds)
      .not("status", "in", "(cancelled,not_required)");

    parts = (partRows ?? []).map((p) => ({
      part_name: p.part_name,
      quantity: p.quantity,
      unit_price: p.unit_price,
      job_name:
        jobs.find((j) => j.job_id === p.job_id)?.name_snapshot ?? "Job",
    }));
  }

  const { data: inspection } = await admin
    .from("inspection")
    .select("inspection_id, completed_at")
    .eq("work_order_id", session.work_order_id)
    .maybeSingle();

  const { data: contract } = await admin
    .from("drop_off_agreement")
    .select("agreement_id")
    .eq("work_order_id", session.work_order_id)
    .maybeSingle();

  const { data: ack } = await admin
    .from("inspection_acknowledgement")
    .select("acknowledgement_id")
    .eq("work_order_id", session.work_order_id)
    .maybeSingle();

  return {
    work_order_id: wo.work_order_id,
    work_order_number: wo.work_order_number,
    status: wo.status,
    customer: wo.customer as unknown as PortalWorkOrderView["customer"],
    motorcycle: wo.motorcycle as unknown as PortalWorkOrderView["motorcycle"],
    jobs,
    parts,
    square_invoice_id: wo.square_invoice_id,
    square_payment_status: wo.square_payment_status,
    inspection_completed: Boolean(inspection?.completed_at),
    has_signed_contract: Boolean(contract),
    has_inspection_ack: Boolean(ack),
  };
}

export async function portalApproveJob(
  token: string,
  jobId: string
): Promise<void> {
  const session = await resolvePortalSession(token);
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("job")
    .select("job_id, work_order_id, status")
    .eq("job_id", jobId)
    .eq("work_order_id", session.work_order_id)
    .maybeSingle();

  if (!job) throw new Error("JOB_NOT_FOUND");
  if (job.status !== "waiting_for_approval") {
    throw new Error("JOB_NOT_AWAITING_APPROVAL");
  }

  const approvedAt = new Date().toISOString();
  await admin
    .from("job")
    .update({
      status: "approved",
      approval_method: "email",
      approved_by_customer_at: approvedAt,
      updated_at: approvedAt,
    })
    .eq("job_id", jobId);

  await addTimelineEvent(admin, {
    work_order_id: session.work_order_id,
    user_id: null,
    event_type: TimelineEventType.CUSTOMER_APPROVAL_RECORDED,
    entity_type: "job",
    entity_id: jobId,
    description: "Customer approved via portal",
    new_value: { approval_method: "email" },
  });
}

export async function portalDeclineJob(
  token: string,
  jobId: string,
  reason: string
): Promise<void> {
  const session = await resolvePortalSession(token);
  const admin = createAdminClient();

  const { data: job } = await admin
    .from("job")
    .select("job_id, work_order_id, status")
    .eq("job_id", jobId)
    .eq("work_order_id", session.work_order_id)
    .maybeSingle();

  if (!job) throw new Error("JOB_NOT_FOUND");

  await admin
    .from("job")
    .update({
      status: "declined",
      approval_method: "email",
      declined_at: new Date().toISOString(),
      decline_reason: reason || "Declined via portal",
    })
    .eq("job_id", jobId);

  await addTimelineEvent(admin, {
    work_order_id: session.work_order_id,
    user_id: null,
    event_type: TimelineEventType.CUSTOMER_DECLINE_RECORDED,
    entity_type: "job",
    entity_id: jobId,
    description: "Customer declined via portal",
    new_value: { approval_method: "email", reason },
  });
}

export async function portalSignContract(
  token: string,
  input: {
    signer_name: string;
    initials: Record<string, string>;
    signature_data_url: string;
  }
): Promise<void> {
  const session = await resolvePortalSession(token);
  if (session.purpose !== "contract" && session.purpose !== "full") {
    throw new Error("FORBIDDEN");
  }

  const admin = createAdminClient();
  const { data: template } = await admin
    .from("drop_off_agreement_template")
    .select("template_id, version, initial_fields")
    .eq("active", true)
    .limit(1)
    .maybeSingle();

  if (!template) throw new Error("CONTRACT_TEMPLATE_NOT_FOUND");

  for (const field of (template.initial_fields as string[]) ?? []) {
    if (!input.initials[field]?.trim()) throw new Error("CONTRACT_INITIALS_REQUIRED");
  }

  const match = input.signature_data_url.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) throw new Error("SIGNATURE_INVALID");

  const ext = match[1] === "jpeg" ? "jpg" : "png";
  const bytes = Buffer.from(match[2], "base64");
  const agreementId = crypto.randomUUID();
  const storagePath = `${session.work_order_id}/${agreementId}.${ext}`;

  const { error: uploadError } = await admin.storage
    .from("contract-signatures")
    .upload(storagePath, bytes, { contentType: `image/${match[1]}`, upsert: false });

  if (uploadError) throw new Error("SIGNATURE_UPLOAD_FAILED");

  const { data: workOrder, error: woError } = await admin
    .from("work_order")
    .select("customer_id, work_order_number")
    .eq("work_order_id", session.work_order_id)
    .maybeSingle();

  if (woError) throw woError;
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");

  await admin.from("drop_off_agreement").insert({
    agreement_id: agreementId,
    work_order_id: session.work_order_id,
    template_id: template.template_id,
    template_version: template.version,
    signer_name: input.signer_name,
    initials: input.initials,
    signature_storage_path: storagePath,
    signed_by_user_id: null,
  });

  await fileDropOffAgreementDocument(admin, {
    customer_id: workOrder.customer_id,
    work_order_id: session.work_order_id,
    work_order_number: workOrder.work_order_number,
    agreement_id: agreementId,
    signature_storage_path: storagePath,
    uploaded_by_user_id: null,
  });

  await addTimelineEvent(admin, {
    work_order_id: session.work_order_id,
    user_id: null,
    event_type: TimelineEventType.DROP_OFF_AGREEMENT_SIGNED,
    entity_type: "drop_off_agreement",
    entity_id: agreementId,
    description: `Drop-off agreement signed by ${input.signer_name} (portal)`,
    new_value: { signer_name: input.signer_name, via: "portal" },
  });
}

export async function portalAcknowledgeInspection(
  token: string,
  input: { signer_name: string; signature_data_url?: string }
): Promise<void> {
  const session = await resolvePortalSession(token);
  const admin = createAdminClient();

  const { data: inspection } = await admin
    .from("inspection")
    .select("inspection_id, completed_at")
    .eq("work_order_id", session.work_order_id)
    .maybeSingle();

  if (!inspection?.completed_at) throw new Error("INSPECTION_NOT_COMPLETED");

  let storagePath: string | null = null;
  if (input.signature_data_url) {
    const match = input.signature_data_url.match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (match) {
      const ext = match[1] === "jpeg" ? "jpg" : "png";
      storagePath = `${session.work_order_id}/inspection-${inspection.inspection_id}.${ext}`;
      await admin.storage
        .from("contract-signatures")
        .upload(storagePath, Buffer.from(match[2], "base64"), {
          contentType: `image/${match[1]}`,
          upsert: false,
        });
    }
  }

  await admin.from("inspection_acknowledgement").upsert(
    {
      work_order_id: session.work_order_id,
      inspection_id: inspection.inspection_id,
      signer_name: input.signer_name,
      signature_storage_path: storagePath,
      portal_token_id: session.token_id,
    },
    { onConflict: "work_order_id,inspection_id" }
  );

  await addTimelineEvent(admin, {
    work_order_id: session.work_order_id,
    user_id: null,
    event_type: TimelineEventType.INSPECTION_ACKNOWLEDGED,
    entity_type: "inspection",
    entity_id: inspection.inspection_id,
    description: `Inspection acknowledged by ${input.signer_name}`,
    new_value: { signer_name: input.signer_name },
  });
}
