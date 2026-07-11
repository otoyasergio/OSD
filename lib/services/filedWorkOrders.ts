import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/database/supabase-server";
import type { JobStatus, PhotoCategory, WorkOrderStatus } from "@/lib/database/types";
import {
  resolvePrimaryPhotoUrls,
  type IntakePhotoRef,
} from "@/lib/services/photos";

export type FiledWorkOrderSearchFields = {
  work_order_number: string;
  external_invoice_number?: string | null;
  customer_first_name?: string | null;
  customer_last_name?: string | null;
  customer_phone?: string | null;
  bike_year?: number | null;
  bike_make?: string | null;
  bike_model?: string | null;
  bike_vin?: string | null;
};

export type CustomerWorkOrderJobSummary = {
  service_name_snapshot: string;
  status: JobStatus;
};

export type CustomerWorkOrderSummary = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  completed_at: string | null;
  date_created: string;
  location_name: string;
  location_code: string;
  motorcycle_label: string;
  jobs: CustomerWorkOrderJobSummary[];
};

export type FiledWorkOrderCard = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number: string | null;
  status: WorkOrderStatus;
  completed_at: string | null;
  date_created: string;
  flags: string[];
  primary_photo_url: string | null;
  motorcycle: {
    year: number;
    make: string;
    model: string;
    vin?: string | null;
    customer: {
      first_name: string;
      last_name: string;
      phone?: string | null;
    } | null;
  } | null;
  primary_technician?: {
    first_name: string;
    last_name: string;
  } | null;
  jobs: CustomerWorkOrderJobSummary[];
};

export function matchesFiledWorkOrderSearch(
  fields: FiledWorkOrderSearchFields,
  query: string
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const haystack = [
    fields.work_order_number,
    fields.external_invoice_number,
    fields.customer_first_name,
    fields.customer_last_name,
    fields.customer_phone,
    fields.bike_year != null ? String(fields.bike_year) : null,
    fields.bike_make,
    fields.bike_model,
    fields.bike_vin,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

export function partitionCustomerWorkOrders(rows: CustomerWorkOrderSummary[]): {
  open: CustomerWorkOrderSummary[];
  filed: CustomerWorkOrderSummary[];
} {
  const open: CustomerWorkOrderSummary[] = [];
  const filed: CustomerWorkOrderSummary[] = [];

  for (const row of rows) {
    if (row.status === "completed") {
      filed.push(row);
    } else {
      open.push(row);
    }
  }

  filed.sort((a, b) => {
    const aKey = a.completed_at ?? a.date_created;
    const bKey = b.completed_at ?? b.date_created;
    return bKey.localeCompare(aKey);
  });

  open.sort((a, b) => b.date_created.localeCompare(a.date_created));

  return { open, filed };
}

type RawCustomerWo = {
  work_order_id: string;
  work_order_number: string;
  status: WorkOrderStatus;
  completed_at: string | null;
  date_created: string;
  location: { name: string; code: string } | null;
  motorcycle: {
    year: number;
    make: string;
    model: string;
  } | null;
  job: Array<{
    service_name_snapshot: string;
    status: JobStatus;
  }> | null;
};

type RawFiledWo = {
  work_order_id: string;
  work_order_number: string;
  external_invoice_number: string | null;
  status: WorkOrderStatus;
  completed_at: string | null;
  date_created: string;
  motorcycle: {
    year: number;
    make: string;
    model: string;
    vin: string | null;
    customer: {
      first_name: string;
      last_name: string;
      phone: string | null;
    } | null;
  } | null;
  primary_technician: {
    first_name: string;
    last_name: string;
  } | null;
  job: Array<{
    service_name_snapshot: string;
    status: JobStatus;
  }> | null;
  intake_photo: Array<{
    photo_id: string;
    storage_path: string;
    photo_url: string | null;
    category: PhotoCategory;
    created_at: string;
  }> | null;
};

export async function listWorkOrdersForCustomer(
  customerId: string
): Promise<{ open: CustomerWorkOrderSummary[]; filed: CustomerWorkOrderSummary[] }> {
  await requireUser();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("work_order")
    .select(
      `
      work_order_id,
      work_order_number,
      status,
      completed_at,
      date_created,
      location:location_id ( name, code ),
      motorcycle:motorcycle_id!inner (
        year,
        make,
        model,
        customer_id
      ),
      job ( service_name_snapshot, status )
    `
    )
    .eq("motorcycle.customer_id", customerId)
    .order("date_created", { ascending: false })
    .limit(200);

  if (error) throw error;

  const rows: CustomerWorkOrderSummary[] = (
    (data ?? []) as unknown as RawCustomerWo[]
  ).map((row) => {
    const bike = row.motorcycle;
    return {
      work_order_id: row.work_order_id,
      work_order_number: row.work_order_number,
      status: row.status,
      completed_at: row.completed_at,
      date_created: row.date_created,
      location_name: row.location?.name ?? "Unknown location",
      location_code: row.location?.code ?? "",
      motorcycle_label: bike
        ? `${bike.year} ${bike.make} ${bike.model}`
        : "Unknown motorcycle",
      jobs: row.job ?? [],
    };
  });

  return partitionCustomerWorkOrders(rows);
}

export async function listCompletedWorkOrdersForActiveLocation(
  query = ""
): Promise<FiledWorkOrderCard[]> {
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
      completed_at,
      date_created,
      motorcycle:motorcycle_id (
        year,
        make,
        model,
        vin,
        customer:customer_id (
          first_name,
          last_name,
          phone
        )
      ),
      primary_technician:primary_technician_id (
        first_name,
        last_name
      ),
      job ( service_name_snapshot, status ),
      intake_photo ( photo_id, storage_path, photo_url, category, created_at )
    `
    )
    .eq("location_id", user.active_location_id!)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  const rawRows = (data ?? []) as unknown as RawFiledWo[];
  const photosByWorkOrder = new Map<string, IntakePhotoRef[]>();
  for (const row of rawRows) {
    photosByWorkOrder.set(row.work_order_id, row.intake_photo ?? []);
  }
  const primaryPhotoUrls = await resolvePrimaryPhotoUrls(
    supabase,
    photosByWorkOrder
  );

  return rawRows
    .filter((row) => {
      const customer = row.motorcycle?.customer;
      const bike = row.motorcycle;
      return matchesFiledWorkOrderSearch(
        {
          work_order_number: row.work_order_number,
          external_invoice_number: row.external_invoice_number,
          customer_first_name: customer?.first_name,
          customer_last_name: customer?.last_name,
          customer_phone: customer?.phone,
          bike_year: bike?.year,
          bike_make: bike?.make,
          bike_model: bike?.model,
          bike_vin: bike?.vin,
        },
        query
      );
    })
    .map((row) => {
      const customer = row.motorcycle?.customer;
      const bike = row.motorcycle;
      return {
        work_order_id: row.work_order_id,
        work_order_number: row.work_order_number,
        external_invoice_number: row.external_invoice_number,
        status: row.status,
        completed_at: row.completed_at,
        date_created: row.date_created,
        flags: [],
        primary_photo_url: primaryPhotoUrls.get(row.work_order_id) ?? null,
        motorcycle: bike
          ? {
              year: bike.year,
              make: bike.make,
              model: bike.model,
              vin: bike.vin,
              customer: customer
                ? {
                    first_name: customer.first_name,
                    last_name: customer.last_name,
                    phone: customer.phone,
                  }
                : null,
            }
          : null,
        primary_technician: row.primary_technician,
        jobs: row.job ?? [],
      };
    });
}
