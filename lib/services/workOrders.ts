import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { DbClient, JobStatus, WorkOrderStatus } from "@/lib/database/types";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { canAssignTechnician, canCreateWorkOrder } from "@/lib/permissions";
import { createWorkOrderSchema } from "@/lib/validation/schemas";
import { recalculateWorkOrderStatus } from "@/lib/status/recalculateWorkOrderStatus";
import { buildWorkOrderFlags } from "@/lib/status/flags";

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
  quality_check_notes: string | null;
  ready_for_pickup_at: string | null;
  completed_at: string | null;
  released_by_user_id: string | null;
  pickup_notes: string | null;
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
  "work_order_id, motorcycle_id, location_id, work_order_number, external_invoice_number, status, primary_technician_id, created_by_user_id, date_created, estimated_completion, mileage, internal_notes, quality_checked_by_user_id, quality_checked_at, quality_check_notes, ready_for_pickup_at, completed_at, released_by_user_id, pickup_notes, created_at, updated_at";

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
      flags: buildWorkOrderFlags({
        status: row.status as WorkOrderStatus,
        vin: motorcycle?.vin,
        external_invoice_number: row.external_invoice_number as string | null,
        estimated_completion: row.estimated_completion as string | null,
        jobs,
        recommendations,
        photoCount: 1, // list view skips photo query; flag only on detail
      }).filter((flag) => flag !== "No intake photos"),
    };
  });
}

export type WorkOrderJob = {
  job_id: string;
  service_id: string;
  service_name_snapshot: string;
  standard_price_snapshot: number | null;
  estimated_labour_snapshot: number | null;
  assigned_technician_id: string | null;
  status: JobStatus;
  notes: string | null;
  approved_by_customer_at: string | null;
  approval_method: string | null;
  declined_at: string | null;
  decline_reason: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  assigned_technician: {
    user_id: string;
    first_name: string;
    last_name: string;
  } | null;
};

export type WorkOrderDetail = WorkOrder & {
  motorcycle: {
    motorcycle_id: string;
    year: number;
    make: string;
    model: string;
    vin: string | null;
    colour: string | null;
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
  technicians: Array<{
    technician_id: string;
    assigned_at: string;
    technician: {
      user_id: string;
      first_name: string;
      last_name: string;
    } | null;
  }>;
  jobs: WorkOrderJob[];
  flags: string[];
  is_foreign_location: boolean;
};

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

export async function getWorkOrderDetail(
  workOrderId: string
): Promise<WorkOrderDetail | null> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      ${WORK_ORDER_COLUMNS},
      motorcycle:motorcycle_id (
        motorcycle_id,
        year,
        make,
        model,
        vin,
        colour,
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
      work_order_technician (
        technician_id,
        assigned_at,
        technician:technician_id (
          user_id,
          first_name,
          last_name
        )
      ),
      job (
        job_id,
        service_id,
        service_name_snapshot,
        standard_price_snapshot,
        estimated_labour_snapshot,
        assigned_technician_id,
        status,
        notes,
        approved_by_customer_at,
        approval_method,
        declined_at,
        decline_reason,
        created_at,
        started_at,
        completed_at,
        assigned_technician:assigned_technician_id (
          user_id,
          first_name,
          last_name
        )
      ),
      recommendation ( severity, status ),
      intake_photo ( photo_id )
    `
    )
    .eq("work_order_id", workOrderId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as Record<string, unknown>;
  const motorcycle = row.motorcycle as WorkOrderDetail["motorcycle"];
  const jobs = (row.job as WorkOrderJob[] | null) ?? [];
  const recommendations =
    (row.recommendation as Array<{ severity: string; status: string }> | null) ??
    [];
  const photos = (row.intake_photo as Array<{ photo_id: string }> | null) ?? [];
  const technicians =
    (row.work_order_technician as WorkOrderDetail["technicians"] | null) ?? [];

  return {
    work_order_id: row.work_order_id as string,
    motorcycle_id: row.motorcycle_id as string,
    location_id: row.location_id as string,
    work_order_number: row.work_order_number as string,
    external_invoice_number: row.external_invoice_number as string | null,
    status: row.status as WorkOrderStatus,
    primary_technician_id: row.primary_technician_id as string | null,
    created_by_user_id: row.created_by_user_id as string | null,
    date_created: row.date_created as string,
    estimated_completion: row.estimated_completion as string | null,
    mileage: row.mileage as number | null,
    internal_notes: row.internal_notes as string | null,
    quality_checked_by_user_id: row.quality_checked_by_user_id as string | null,
    quality_checked_at: row.quality_checked_at as string | null,
    quality_check_notes: row.quality_check_notes as string | null,
    ready_for_pickup_at: row.ready_for_pickup_at as string | null,
    completed_at: row.completed_at as string | null,
    released_by_user_id: row.released_by_user_id as string | null,
    pickup_notes: row.pickup_notes as string | null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    motorcycle,
    primary_technician:
      row.primary_technician as WorkOrderDetail["primary_technician"],
    technicians,
    jobs,
    flags: buildWorkOrderFlags({
      status: row.status as WorkOrderStatus,
      vin: motorcycle?.vin,
      external_invoice_number: row.external_invoice_number as string | null,
      estimated_completion: row.estimated_completion as string | null,
      jobs,
      recommendations,
      photoCount: photos.length,
    }),
    is_foreign_location: row.location_id !== user.active_location_id,
  };
}

async function assertCanMutateWorkOrder(
  workOrderId: string
): Promise<{ user: Awaited<ReturnType<typeof requireUser>>; workOrder: WorkOrder }> {
  const user = await requireUser();
  if (!canAssignTechnician(user.role)) throw new Error("FORBIDDEN");

  const workOrder = await getWorkOrderById(workOrderId);
  if (!workOrder) throw new Error("WORK_ORDER_NOT_FOUND");
  if (workOrder.location_id !== user.active_location_id) {
    throw new Error("FOREIGN_LOCATION");
  }
  return { user, workOrder };
}

export async function assignTechnicianToWorkOrder(
  workOrderId: string,
  technicianId: string
): Promise<void> {
  const { user, workOrder } = await assertCanMutateWorkOrder(workOrderId);
  const supabase = await createClient();

  const { data: tech, error: techError } = await supabase
    .from("app_user")
    .select("user_id, first_name, last_name, role, status")
    .eq("user_id", technicianId)
    .maybeSingle();

  if (techError) throw techError;
  if (!tech || tech.role !== "technician" || tech.status !== "active") {
    throw new Error("TECHNICIAN_NOT_FOUND");
  }

  const { error } = await supabase.from("work_order_technician").upsert(
    {
      work_order_id: workOrderId,
      technician_id: technicianId,
      assigned_by_user_id: user.user_id,
      assigned_at: new Date().toISOString(),
    },
    { onConflict: "work_order_id,technician_id" }
  );
  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.TECHNICIAN_ASSIGNED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Technician ${tech.first_name} ${tech.last_name} assigned`,
    new_value: { technician_id: technicianId },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "technician_assigned",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Technician ${tech.first_name} ${tech.last_name} assigned to ${workOrder.work_order_number}`,
    new_value: { technician_id: technicianId },
  });
}

export async function setPrimaryTechnician(
  workOrderId: string,
  technicianId: string | null
): Promise<void> {
  const { user, workOrder } = await assertCanMutateWorkOrder(workOrderId);
  const supabase = await createClient();

  if (technicianId) {
    const { data: tech, error: techError } = await supabase
      .from("app_user")
      .select("user_id, role, status")
      .eq("user_id", technicianId)
      .maybeSingle();

    if (techError) throw techError;
    if (!tech || tech.role !== "technician" || tech.status !== "active") {
      throw new Error("TECHNICIAN_NOT_FOUND");
    }

    const { error: assignError } = await supabase
      .from("work_order_technician")
      .upsert(
        {
          work_order_id: workOrderId,
          technician_id: technicianId,
          assigned_by_user_id: user.user_id,
          assigned_at: new Date().toISOString(),
        },
        { onConflict: "work_order_id,technician_id" }
      );
    if (assignError) throw assignError;
  }

  const { error } = await supabase
    .from("work_order")
    .update({
      primary_technician_id: technicianId,
      updated_at: new Date().toISOString(),
    })
    .eq("work_order_id", workOrderId);

  if (error) throw error;

  await addTimelineEvent(supabase, {
    work_order_id: workOrderId,
    user_id: user.user_id,
    event_type: TimelineEventType.PRIMARY_TECHNICIAN_CHANGED,
    entity_type: "work_order",
    entity_id: workOrderId,
    description: technicianId
      ? "Primary technician changed"
      : "Primary technician cleared",
    old_value: { primary_technician_id: workOrder.primary_technician_id },
    new_value: { primary_technician_id: technicianId },
  });

  await addAuditLog(supabase, {
    actor_user_id: user.user_id,
    location_id: workOrder.location_id,
    action: "primary_technician_changed",
    entity_type: "work_order",
    entity_id: workOrderId,
    description: `Primary technician updated on ${workOrder.work_order_number}`,
    old_value: { primary_technician_id: workOrder.primary_technician_id },
    new_value: { primary_technician_id: technicianId },
  });
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
