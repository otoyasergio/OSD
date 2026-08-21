import { requireUser } from "@/lib/auth/session";
import { resolveReadSubject, type ReadView } from "@/lib/auth/role-preview-shared";
import { createClient } from "@/lib/database/supabase-server";
import type { JobStatus, PartStatus, WorkOrderStatus } from "@/lib/database/types";
import { canViewClients, canViewPartsBoard, isFloorTech } from "@/lib/permissions";
import { PART_STATUS_LABELS } from "@/lib/status/labels";

export type PartsBoardBucket = "to_order" | "in_stock" | "ordered";

export type PartsWaitingItem = {
  part_id: string;
  part_name: string;
  part_number: string | null;
  supplier: string | null;
  quantity: number;
  unit_price: number | null;
  supplier_stock: number | null;
  status: Extract<PartStatus, "needed" | "in_stock" | "ordered">;
  bucket: PartsBoardBucket;
  status_label: string;
  ordered_at: string | null;
  created_at: string;
  waiting_since: string;
  days_waiting: number;
  job_id: string;
  job_name: string;
  job_status: JobStatus;
  assigned_technician_id: string | null;
  assigned_technician_label: string | null;
  work_order_id: string;
  work_order_number: string;
  work_order_status: WorkOrderStatus;
  customer_label: string;
  motorcycle_label: string;
  href: string;
};

const BOARD_STATUSES: Array<Extract<PartStatus, "needed" | "in_stock" | "ordered">> = [
  "needed",
  "in_stock",
  "ordered",
];

const ORDERABLE_JOB_STATUSES: JobStatus[] = [
  "approved",
  "waiting_for_parts",
  "ready_to_start",
  "in_progress",
];

type NestedCustomer = { first_name: string; last_name: string };
type NestedMotorcycle = {
  year: number;
  make: string;
  model: string;
  customer: NestedCustomer | NestedCustomer[] | null;
};
type NestedTechnician = {
  user_id: string;
  first_name: string;
  last_name: string;
};
type NestedWorkOrder = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  location_id: string;
  motorcycle: NestedMotorcycle | NestedMotorcycle[] | null;
};
type NestedJob = {
  job_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  assigned_technician_id: string | null;
  assigned_technician: NestedTechnician | NestedTechnician[] | null;
  work_order: NestedWorkOrder | NestedWorkOrder[] | null;
};

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  const ms = now.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function resolveBucket(
  status: Extract<PartStatus, "needed" | "in_stock" | "ordered">,
  jobStatus: JobStatus
): PartsBoardBucket | null {
  if (status === "in_stock") return "in_stock";
  if (status === "ordered") return "ordered";
  // To order: still needed, and job already approved (or later).
  if (status === "needed" && ORDERABLE_JOB_STATUSES.includes(jobStatus)) {
    return "to_order";
  }
  return null;
}

export async function listPartsWaitingForLocation(
  locationId: string,
  options?: {
    technicianId?: string;
    /** Trusted presentation principal (owner "view as") — read shaping only. */
    view?: ReadView;
  }
): Promise<PartsWaitingItem[]> {
  const user = await requireUser();
  const subject = resolveReadSubject(user, options?.view);
  if (!canViewPartsBoard(user.role)) throw new Error("FORBIDDEN");
  if (locationId !== user.active_location_id) throw new Error("FOREIGN_LOCATION");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("part")
    .select(
      `
      part_id,
      part_name,
      part_number,
      supplier,
      quantity,
      unit_price,
      supplier_stock,
      status,
      ordered_at,
      created_at,
      job:job_id (
        job_id,
        service_name_snapshot,
        status,
        assigned_technician_id,
        assigned_technician:assigned_technician_id (
          user_id,
          first_name,
          last_name
        ),
        work_order:work_order_id (
          work_order_id,
          work_order_number,
          status,
          location_id,
          motorcycle:motorcycle_id (
            year,
            make,
            model,
            customer:customer_id (
              first_name,
              last_name
            )
          )
        )
      )
    `
    )
    .in("status", BOARD_STATUSES)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const now = new Date();
  const technicianFilter = isFloorTech(subject.role)
    ? subject.userId
    : options?.technicianId?.trim() || "";
  const showClients = canViewClients(subject.role);
  const items: PartsWaitingItem[] = [];

  for (const row of (data ?? []) as unknown as Array<{
    part_id: string;
    part_name: string;
    part_number: string | null;
    supplier: string | null;
    quantity: number;
    unit_price: number | null;
    supplier_stock: number | null;
    status: Extract<PartStatus, "needed" | "in_stock" | "ordered">;
    ordered_at: string | null;
    created_at: string;
    job: NestedJob | NestedJob[] | null;
  }>) {
    const job = unwrapOne(row.job);
    const workOrder = unwrapOne(job?.work_order);
    if (!job || !workOrder) continue;
    if (workOrder.location_id !== locationId) continue;
    if (workOrder.status === "completed" || workOrder.status === "cancelled") {
      continue;
    }
    if (technicianFilter && job.assigned_technician_id !== technicianFilter) {
      continue;
    }

    const bucket = resolveBucket(row.status, job.status);
    if (!bucket) continue;

    const motorcycle = unwrapOne(workOrder.motorcycle);
    const customer = unwrapOne(motorcycle?.customer);
    const technician = unwrapOne(job.assigned_technician);
    const waitingSince =
      row.status === "ordered" && row.ordered_at ? row.ordered_at : row.created_at;

    items.push({
      part_id: row.part_id,
      part_name: row.part_name,
      part_number: row.part_number,
      supplier: row.supplier,
      quantity: row.quantity,
      unit_price: row.unit_price,
      supplier_stock: row.supplier_stock,
      status: row.status,
      bucket,
      status_label: PART_STATUS_LABELS[row.status] ?? row.status,
      ordered_at: row.ordered_at,
      created_at: row.created_at,
      waiting_since: waitingSince,
      days_waiting: daysBetween(waitingSince, now),
      job_id: job.job_id,
      job_name: job.service_name_snapshot,
      job_status: job.status,
      assigned_technician_id: job.assigned_technician_id,
      assigned_technician_label: technician
        ? `${technician.first_name} ${technician.last_name}`
        : null,
      work_order_id: workOrder.work_order_id,
      work_order_number: workOrder.work_order_number,
      work_order_status: workOrder.status,
      customer_label:
        showClients && customer ? `${customer.first_name} ${customer.last_name}` : "",
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : "Unknown motorcycle",
      href: `/work_orders/${workOrder.work_order_id}?tab=parts`,
    });
  }

  items.sort((a, b) => {
    if (a.days_waiting !== b.days_waiting) {
      return b.days_waiting - a.days_waiting;
    }
    return a.part_name.localeCompare(b.part_name);
  });

  return items;
}
