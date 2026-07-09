import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, JobStatus, WorkOrderStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canCreateWorkOrder } from "@/lib/permissions";
import { createWorkOrderSchema } from "@/lib/validation/schemas";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";

export type WorkOrder = {
  work_order_id: string;
  motorcycle_id: string;
  location_id: string;
  work_order_number: string;
  external_invoice_number: string | null;
  status: WorkOrderStatus;
  primary_technician_id: string | null;
  created_by_user_id: string | null;
  date_created: string;
  estimated_completion: string | null;
  mileage: number | null;
  internal_notes: string | null;
  quality_checked_by_user_id: string | null;
  quality_checked_at: string | null;
  ready_for_pickup_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkOrderListItem = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number: string | null;
  status: WorkOrderStatus;
  mileage: number | null;
  date_created: string;
  estimated_completion: string | null;
  motorcycle: {
    motorcycle_id: string;
    year: number;
    make: string;
    model: string;
    vin: string | null;
    customer: {
      customer_id: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      email: string | null;
    } | null;
  } | null;
  primary_technician: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
  flags: string[];
};

export type CreateWorkOrderInput = {
  motorcycle_id: string;
  location_id: string;
  external_invoice_number?: string | null;
  mileage?: number | null;
  estimated_completion?: string | null;
  internal_notes?: string | null;
  primary_technician_id?: string | null;
  service_ids?: string[];
};

export type TechnicianOption = {
  user_id: string;
  first_name: string;
  last_name: string;
};

const WORK_ORDER_COLUMNS =
  "work_order_id, motorcycle_id, location_id, work_order_number, external_invoice_number, status, primary_technician_id, created_by_user_id, date_created, estimated_completion, mileage, internal_notes, quality_checked_by_user_id, quality_checked_at, ready_for_pickup_at, completed_at, created_at, updated_at";

function normalizeOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function listTechniciansForActiveLocation(): Promise<
  TechnicianOption[]
> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: memberships, error: membershipError } = await supabase
    .from("user_location")
    .select("user_id")
    .eq("location_id", user.active_location_id!);

  if (membershipError) throw membershipError;

  const userIds = (memberships ?? []).map(
    (row: { user_id: string }) => row.user_id
  );
  if (userIds.length === 0) return [];

  const { data, error } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name")
    .eq("role", "technician")
    .eq("status", "active")
    .in("user_id", userIds)
    .order("last_name")
    .order("first_name");

  if (error) throw error;
  return (data ?? []) as TechnicianOption[];
}

export async function listWorkOrdersForActiveLocation(): Promise<
  WorkOrderListItem[]
> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      external_invoice_number,
      status,
      mileage,
      date_created,
      estimated_completion,
      motorcycle:motorcycle_id (
        motorcycle_id,
        year,
        make,
        model,
        vin,
        customer:customer_id (
          customer_id,
          first_name,
          last_name,
          phone,
          email
        )
      ),
      primary_technician:primary_technician_id (
        user_id,
        first_name,
        last_name
      ),
      job ( status ),
      recommendation ( severity, status )
    `
    )
    .eq("location_id", user.active_location_id!)
    .order("date_created", { ascending: false })
    .limit(100);

  if (error) throw error;

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const motorcycle = row.motorcycle as WorkOrderListItem["motorcycle"];
    const jobs = (row.job as Array<{ status: string }> | null) ?? [];
    const recommendations =
      (row.recommendation as Array<{ severity: string; status: string }> | null) ??
      [];

    const flags: string[] = [];
    if (!motorcycle?.vin) flags.push("Missing VIN");
    if (jobs.some((job) => job.status === "waiting_for_approval")) {
      flags.push("Needs approval");
    }
    if (
      recommendations.some(
        (rec) =>
          rec.status === "pending" && rec.severity === "safety_critical"
      )
    ) {
      flags.push("Safety-critical");
    }
    if (row.status === "waiting_for_parts") flags.push("Waiting for parts");
    if (row.status === "on_hold") flags.push("On hold");

    return {
      work_order_id: row.work_order_id as string,
      work_order_number: row.work_order_number as string,
      external_invoice_number: row.external_invoice_number as string | null,
      status: row.status as WorkOrderStatus,
      mileage: row.mileage as number | null,
      date_created: row.date_created as string,
      estimated_completion: row.estimated_completion as string | null,
      motorcycle,
      primary_technician:
        row.primary_technician as WorkOrderListItem["primary_technician"],
      flags,
    };
  });
}

export async function getWorkOrderById(
  workOrderId: string
): Promise<WorkOrder | null> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("work_order")
    .select(WORK_ORDER_COLUMNS)
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  return (data as WorkOrder) ?? null;
}

async function mintWorkOrderNumber(
  supabase: DbClient,
  locationId: string
): Promise<string> {
  const { data, error } = await supabase.rpc("mint_work_order_number", {
    p_location_id: locationId,
  });
  if (error) throw error;
  if (!data || typeof data !== "string") {
    throw new Error("WORK_ORDER_NUMBER_FAILED");
  }
  return data;
}

export async function createWorkOrder(
  input: CreateWorkOrderInput
): Promise<{ work_order_id: string; work_order_number: string }> {
  const user = await requireUser();
  if (!canCreateWorkOrder(user.role)) throw new Error("FORBIDDEN");

  const parsed = createWorkOrderSchema.parse({
    ...input,
    external_invoice_number: normalizeOptional(input.external_invoice_number),
    internal_notes: normalizeOptional(input.internal_notes),
    primary_technician_id: normalizeOptional(input.primary_technician_id),
    estimated_completion: normalizeOptional(input.estimated_completion),
    service_ids: input.service_ids ?? [],
  });

  if (parsed.location_id !== user.active_location_id) {
    throw new Error("LOCATION_MISMATCH");
  }

  const supabase = await createClient();

  const { data: motorcycle, error: motorcycleError } = await supabase
    .from("motorcycle")
    .select("motorcycle_id, customer_id, year, make, model")
    .eq("motorcycle_id", parsed.motorcycle_id)
    .maybeSingle();

  if (motorcycleError) throw motorcycleError;
  if (!motorcycle) throw new Error("MOTORCYCLE_NOT_FOUND");

  let services: Array<{
    service_id: string;
    name: string;
    standard_price: number | null;
    estimated_labour: number | null;
    active: boolean;
  }> = [];

  if (parsed.service_ids.length > 0) {
    const { data: serviceRows, error: serviceError } = await supabase
      .from("service")
      .select("service_id, name, standard_price, estimated_labour, active")
      .in("service_id", parsed.service_ids)
      .eq("active", true);

    if (serviceError) throw serviceError;
    services = serviceRows ?? [];
    if (services.length !== parsed.service_ids.length) {
      throw new Error("SERVICE_NOT_FOUND");
    }
  }

  if (parsed.primary_technician_id) {
    const { data: tech, error: techError } = await supabase
      .from("app_user")
      .select("user_id, role, status")
      .eq("user_id", parsed.primary_technician_id)
      .maybeSingle();

    if (techError) throw techError;
    if (!tech || tech.role !== "technician" || tech.status !== "active") {
      throw new Error("TECHNICIAN_NOT_FOUND");
    }
  }

  const workOrderNumber = await mintWorkOrderNumber(
    supabase,
    parsed.location_id
  );
  const initialStatus: WorkOrderStatus =
    services.length > 0 ? "open" : "draft";

  const { data: workOrder, error: woError } = await supabase
    .from("work_order")
    .insert({
      motorcycle_id: parsed.motorcycle_id,
      location_id: parsed.location_id,
      work_order_number: workOrderNumber,
      external_invoice_number: parsed.external_invoice_number ?? null,
      status: initialStatus,
      primary_technician_id: parsed.primary_technician_id ?? null,
      created_by_user_id: user.user_id,
      mileage: parsed.mileage ?? null,
      estimated_completion: parsed.estimated_completion ?? null,
      internal_notes: parsed.internal_notes ?? null,
    })
    .select("work_order_id, work_order_number, location_id, status")
    .single();

  if (woError) throw woError;

  const workOrderId = workOrder.work_order_id as string;

  if (parsed.primary_technician_id) {
    const { error: assignError } = await supabase
      .from("work_order_technician")
      .insert({
        work_order_id: workOrderId,
        technician_id: parsed.primary_technician_id,
        assigned_by_user_id: user.user_id,
      });
    if (assignError) throw assignError;
  }

  const { data: inspection, error: inspectionError } = await supabase
    .from("inspection")
    .insert({ work_order_id: workOrderId })
    .select("inspection_id")
    .single();

  if (inspectionError) throw inspectionError;

  const { data: templateItems, error: templateError } = await supabase
    .from("inspection_template_item")
    .select(
      "template_item_id, category, item_name, display_order, requires_measurement"
    )
    .eq("active", true)
    .order("display_order");

  if (templateError) throw templateError;

  if ((templateItems ?? []).length > 0) {
    const { error: resultsError } = await supabase
      .from("inspection_result")
      .insert(
        (templateItems ?? []).map(
          (item: {
            template_item_id: string;
            category: string;
            item_name: string;
            display_order: number;
            requires_measurement: boolean;
          }) => ({
            inspection_id: inspection.inspection_id,
            template_item_id: item.template_item_id,
            category_snapshot: item.category,
            item_name_snapshot: item.item_name,
            display_order_snapshot: item.display_order,
            requires_measurement_snapshot: item.requires_measurement,
          })
        )
      );
    if (resultsError) throw resultsError;
  }

  const createdJobs: Array<{ job_id: string; service_name_snapshot: string }> =
    [];

  for (const service of services) {
    // Booked intake services are already customer-approved.
    const jobStatus: JobStatus = "approved";
    const { data: job, error: jobError } = await supabase
      .from("job")
      .insert({
        work_order_id: workOrderId,
        service_id: service.service_id,
        service_name_snapshot: service.name,
        standard_price_snapshot: service.standard_price,
        estimated_labour_snapshot: service.estimated_labour,
        status: jobStatus,
        created_by_user_id: user.user_id,
        approved_by_customer_at: new Date().toISOString(),
        approval_method: "in_person",
        approval_recorded_by_user_id: user.user_id,
      })
      .select("job_id, service_name_snapshot")
      .single();

    if (jobError) throw jobError;
    createdJobs.push(job);
  }

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.WORK_ORDER_CREATED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Work order ${workOrderNumber} created`,
    new_value: {
      work_order_number: workOrderNumber,
      motorcycle_id: parsed.motorcycle_id,
      status: initialStatus,
    },
  });

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.INSPECTION_CREATED,
    entity_type: "inspection",
    entity_id: inspection.inspection_id,
    description: "Inspection created from active template",
  });

  for (const job of createdJobs) {
    await addTimelineEvent(supabase, {
      work_order_id: workOrderId,
      user_id: user.user_id,
      event_type: TimelineEventType.JOB_CREATED,
      entity_type: "job",
      entity_id: job.job_id,
      description: `Job created: ${job.service_name_snapshot}`,
    });
  }

  if (parsed.primary_technician_id) {
    await addTimelineEvent(supabase, {
      work_order_id: workOrderId,
      user_id: user.user_id,
      event_type: TimelineEventType.PRIMARY_TECHNICIAN_CHANGED,
      entity_type: "work_order",
      entity_id: workOrderId,
      description: "Primary technician assigned",
      new_value: { primary_technician_id: parsed.primary_technician_id },
    });
  }

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: parsed.location_id,
    action: "work_order_created",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Work order ${workOrderNumber} created`,
    new_value: {
      work_order_id: workOrderId,
      work_order_number: workOrderNumber,
      motorcycle_id: parsed.motorcycle_id,
      service_ids: parsed.service_ids,
      status: initialStatus,
    },
  });

  await recalculateWorkOrderStatus(supabase, workOrderId, user.user_id);

  return {
    work_order_id: workOrderId,
    work_order_number: workOrderNumber,
  };
}
