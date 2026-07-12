import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type {
  JobStatus,
  PhotoCategory,
  WorkOrderStatus,
} from "@/lib/database/types";
import { WORK_ORDER_STATUS_LABELS, JOB_STATUS_LABELS } from "@/lib/status/labels";
import {
  resolvePrimaryPhotoUrls,
  type IntakePhotoRef,
} from "@/lib/services/photos";

export type TechnicianAssignedJob = {
  job_id: string;
  service_name_snapshot: string;
  status: JobStatus;
  status_label: string;
  work_order_id: string;
  work_order_number: string;
  work_order_status: WorkOrderStatus;
  work_order_status_label: string;
  motorcycle_label: string;
  customer_label: string;
  href: string;
  inspection_complete: boolean;
  inspection_href: string;
  primary_photo_url: string | null;
};

export type TechnicianAssignedWorkOrder = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  status_label: string;
  motorcycle_label: string;
  customer_label: string;
  is_primary: boolean;
  inspection_complete: boolean;
  primary_photo_url: string | null;
  jobs: Array<{
    job_id: string;
    service_name_snapshot: string;
    status: JobStatus;
    status_label: string;
    assigned_to_me: boolean;
  }>;
  overview_href: string;
  inspection_href: string;
  jobs_href: string;
};

export type TechnicianDashboard = {
  workOrders: TechnicianAssignedWorkOrder[];
  myJobs: TechnicianAssignedJob[];
};

const ACTIVE_WO: WorkOrderStatus[] = [
  "draft",
  "open",
  "inspection_in_progress",
  "waiting_for_customer_approval",
  "waiting_for_parts",
  "ready_for_technician",
  "in_progress",
  "quality_check",
  "ready_for_pickup",
  "on_hold",
];

export async function getTechnicianDashboard(): Promise<TechnicianDashboard> {
  const user = await requireUser();
  const supabase = await createClient();
  const locationId = user.active_location_id!;

  const { data: woTechRows, error: woTechError } = await supabase
    .from("work_order_technician")
    .select("work_order_id")
    .eq("technician_id", user.user_id);
  if (woTechError) throw woTechError;

  const assignedWoIds = [
    ...new Set(
      (woTechRows ?? []).map((row: { work_order_id: string }) => row.work_order_id)
    ),
  ];

  const { data: jobRows, error: jobError } = await supabase
    .from("job")
    .select(
      `
      job_id,
      service_name_snapshot,
      status,
      assigned_technician_id,
      work_order:work_order_id (
        work_order_id,
        work_order_number,
        status,
        location_id,
        primary_technician_id,
        motorcycle:motorcycle_id (
          year,
          make,
          model,
          customer:customer_id ( first_name, last_name )
        ),
        inspection ( completed_at ),
        intake_photo ( photo_id, storage_path, photo_url, category, created_at )
      )
    `
    )
    .eq("assigned_technician_id", user.user_id)
    .not("status", "in", '("completed","cancelled","declined")');
  if (jobError) throw jobError;

  type NestedCustomer = { first_name: string; last_name: string };
  type NestedMotorcycle = {
    year: number;
    make: string;
    model: string;
    customer: NestedCustomer | NestedCustomer[] | null;
  };
  type NestedPhoto = {
    photo_id: string;
    storage_path: string;
    photo_url: string | null;
    category: PhotoCategory;
    created_at: string;
  };
  type NestedWo = {
    work_order_id: string;
    work_order_number: string;
    status: WorkOrderStatus;
    location_id: string;
    primary_technician_id: string | null;
    motorcycle: NestedMotorcycle | NestedMotorcycle[] | null;
    inspection: Array<{ completed_at: string | null }> | null;
    intake_photo: NestedPhoto[] | null;
  };

  const myJobsDraft: Array<Omit<TechnicianAssignedJob, "primary_photo_url">> =
    [];
  const jobWoIds = new Set<string>();
  const jobPhotosByWo = new Map<string, IntakePhotoRef[]>();

  for (const row of (jobRows ?? []) as unknown as Array<{
    job_id: string;
    service_name_snapshot: string;
    status: JobStatus;
    work_order: NestedWo | NestedWo[] | null;
  }>) {
    const woRaw = Array.isArray(row.work_order) ? row.work_order[0] : row.work_order;
    if (!woRaw || woRaw.location_id !== locationId) continue;
    if (!ACTIVE_WO.includes(woRaw.status)) continue;

    const motorcycle = Array.isArray(woRaw.motorcycle)
      ? woRaw.motorcycle[0]
      : woRaw.motorcycle;
    const customerRaw = motorcycle?.customer;
    const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;

    const inspectionComplete = Boolean(woRaw.inspection?.[0]?.completed_at);
    jobWoIds.add(woRaw.work_order_id);
    if (!jobPhotosByWo.has(woRaw.work_order_id)) {
      jobPhotosByWo.set(woRaw.work_order_id, woRaw.intake_photo ?? []);
    }
    myJobsDraft.push({
      job_id: row.job_id,
      service_name_snapshot: row.service_name_snapshot,
      status: row.status,
      status_label: JOB_STATUS_LABELS[row.status] ?? row.status,
      work_order_id: woRaw.work_order_id,
      work_order_number: woRaw.work_order_number,
      work_order_status: woRaw.status,
      work_order_status_label:
        WORK_ORDER_STATUS_LABELS[woRaw.status] ?? woRaw.status,
      motorcycle_label: motorcycle
        ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
        : "—",
      customer_label: customer
        ? `${customer.first_name} ${customer.last_name}`
        : "—",
      href: `/work_orders/${woRaw.work_order_id}?tab=jobs`,
      inspection_complete: inspectionComplete,
      inspection_href: `/work_orders/${woRaw.work_order_id}/inspection`,
    });
  }

  const allWoIds = [...new Set([...assignedWoIds, ...jobWoIds])];
  if (allWoIds.length === 0) {
    return { workOrders: [], myJobs: [] };
  }

  const { data: workOrders, error: woError } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      status,
      location_id,
      primary_technician_id,
      motorcycle:motorcycle_id (
        year,
        make,
        model,
        customer:customer_id ( first_name, last_name )
      ),
      inspection ( completed_at ),
      intake_photo ( photo_id, storage_path, photo_url, category, created_at ),
      job (
        job_id,
        service_name_snapshot,
        status,
        assigned_technician_id
      )
    `
    )
    .in("work_order_id", allWoIds)
    .eq("location_id", locationId)
    .order("date_created", { ascending: false });
  if (woError) throw woError;

  const photosByWorkOrder = new Map<string, IntakePhotoRef[]>(jobPhotosByWo);
  const activeWorkOrders = (
    (workOrders ?? []) as unknown as Array<{
      work_order_id: string;
      work_order_number: string;
      status: WorkOrderStatus;
      primary_technician_id: string | null;
      motorcycle: NestedWo["motorcycle"];
      inspection: Array<{ completed_at: string | null }> | null;
      intake_photo: NestedPhoto[] | null;
      job: Array<{
        job_id: string;
        service_name_snapshot: string;
        status: JobStatus;
        assigned_technician_id: string | null;
      }> | null;
    }>
  ).filter((wo) => ACTIVE_WO.includes(wo.status));

  for (const wo of activeWorkOrders) {
    photosByWorkOrder.set(wo.work_order_id, wo.intake_photo ?? []);
  }

  const primaryPhotoUrls = await resolvePrimaryPhotoUrls(
    supabase,
    photosByWorkOrder
  );

  const myJobs: TechnicianAssignedJob[] = myJobsDraft.map((job) => ({
    ...job,
    primary_photo_url: primaryPhotoUrls.get(job.work_order_id) ?? null,
  }));

  const workOrderList: TechnicianAssignedWorkOrder[] = activeWorkOrders.map(
    (wo) => {
      const motorcycle = Array.isArray(wo.motorcycle)
        ? wo.motorcycle[0]
        : wo.motorcycle;
      const customerRaw = motorcycle?.customer;
      const customer = Array.isArray(customerRaw) ? customerRaw[0] : customerRaw;
      const inspectionComplete = Boolean(wo.inspection?.[0]?.completed_at);
      return {
        work_order_id: wo.work_order_id,
        work_order_number: wo.work_order_number,
        status: wo.status,
        status_label: WORK_ORDER_STATUS_LABELS[wo.status] ?? wo.status,
        motorcycle_label: motorcycle
          ? `${motorcycle.year} ${motorcycle.make} ${motorcycle.model}`
          : "—",
        customer_label: customer
          ? `${customer.first_name} ${customer.last_name}`
          : "—",
        is_primary: wo.primary_technician_id === user.user_id,
        inspection_complete: inspectionComplete,
        primary_photo_url: primaryPhotoUrls.get(wo.work_order_id) ?? null,
        jobs: (wo.job ?? []).map((job) => ({
          job_id: job.job_id,
          service_name_snapshot: job.service_name_snapshot,
          status: job.status,
          status_label: JOB_STATUS_LABELS[job.status] ?? job.status,
          assigned_to_me: job.assigned_technician_id === user.user_id,
        })),
        overview_href: `/work_orders/${wo.work_order_id}`,
        inspection_href: `/work_orders/${wo.work_order_id}/inspection`,
        jobs_href: `/work_orders/${wo.work_order_id}?tab=jobs`,
      };
    }
  );

  return { workOrders: workOrderList, myJobs };
}
