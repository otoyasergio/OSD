import { createAdminClient } from "@/lib/database/supabase-admin";
import { addAuditLog } from "@/lib/audit/addAuditLog";
import { addTimelineEvent } from "@/lib/timeline/addTimelineEvent";
import { TimelineEventType } from "@/lib/timeline/events";
import { getWixBooking, type WixBookingPayload } from "@/lib/wix/config";

export type BookingWebhookResult = {
  work_order_id: string;
  work_order_number: string;
  customer_id: string;
  created: boolean;
};

async function findOrCreateCustomerFromBooking(
  booking: WixBookingPayload,
  admin: ReturnType<typeof createAdminClient>
): Promise<string> {
  const contact = booking.contact;
  const wixContactId = booking.contactId;

  if (wixContactId) {
    const { data: existing } = await admin
      .from("customer")
      .select("customer_id")
      .eq("wix_contact_id", wixContactId)
      .maybeSingle();
    if (existing) return existing.customer_id;
  }

  const email = contact?.email?.trim() || null;
  const phone = contact?.phone?.trim() || null;

  if (email) {
    const { data: byEmail } = await admin
      .from("customer")
      .select("customer_id, wix_contact_id")
      .ilike("email", email)
      .maybeSingle();
    if (byEmail) {
      if (wixContactId && !byEmail.wix_contact_id) {
        await admin
          .from("customer")
          .update({ wix_contact_id: wixContactId })
          .eq("customer_id", byEmail.customer_id);
      }
      return byEmail.customer_id;
    }
  }

  const { data: created, error } = await admin
    .from("customer")
    .insert({
      first_name: contact?.firstName?.trim() || "Booking",
      last_name: contact?.lastName?.trim() || "Customer",
      email,
      phone,
      wix_contact_id: wixContactId ?? null,
      notes: "Created from Wix Bookings",
    })
    .select("customer_id")
    .single();

  if (error) throw error;
  return created.customer_id;
}

async function findMotorcycleForCustomer(
  customerId: string,
  formInfo: Record<string, string> | undefined,
  admin: ReturnType<typeof createAdminClient>
): Promise<string | null> {
  const { data: bikes } = await admin
    .from("motorcycle")
    .select("motorcycle_id, year, make, model")
    .eq("customer_id", customerId);

  if (!bikes?.length) return null;

  const year = formInfo?.year ? Number(formInfo.year) : null;
  const make = formInfo?.make?.trim();
  const model = formInfo?.model?.trim();

  if (year && make && model) {
    const match = bikes.find(
      (b) =>
        b.year === year &&
        b.make.toLowerCase() === make.toLowerCase() &&
        b.model.toLowerCase() === model.toLowerCase()
    );
    if (match) return match.motorcycle_id;
  }

  return bikes[0]?.motorcycle_id ?? null;
}

async function mintWorkOrderNumberAdmin(
  admin: ReturnType<typeof createAdminClient>,
  locationId: string
): Promise<string> {
  const { data, error } = await admin.rpc("mint_work_order_number", {
    p_location_id: locationId,
  });
  if (error) throw error;
  if (!data || typeof data !== "string") throw new Error("WORK_ORDER_NUMBER_FAILED");
  return data;
}

async function createBookingWorkOrder(
  admin: ReturnType<typeof createAdminClient>,
  input: {
    motorcycleId: string;
    customerId: string;
    locationId: string;
    bookingId: string;
    scheduledAt: string;
    internalNotes: string;
  }
): Promise<{ work_order_id: string; work_order_number: string }> {
  const workOrderNumber = await mintWorkOrderNumberAdmin(admin, input.locationId);

  const { data: workOrder, error: woError } = await admin
    .from("work_order")
    .insert({
      motorcycle_id: input.motorcycleId,
      customer_id: input.customerId,
      location_id: input.locationId,
      work_order_number: workOrderNumber,
      status: "open",
      mileage: null,
      internal_notes: input.internalNotes,
      wix_booking_id: input.bookingId,
      scheduled_at: input.scheduledAt,
      source: "wix_booking",
      created_by_user_id: null,
    })
    .select("work_order_id, work_order_number")
    .single();

  if (woError) throw woError;

  const { data: inspection, error: inspectionError } = await admin
    .from("inspection")
    .insert({ work_order_id: workOrder.work_order_id })
    .select("inspection_id")
    .single();

  if (inspectionError) throw inspectionError;

  const { data: templateItems } = await admin
    .from("inspection_template_item")
    .select(
      "template_item_id, category, item_name, display_order, requires_measurement"
    )
    .eq("active", true)
    .order("display_order");

  if ((templateItems ?? []).length > 0) {
    await admin.from("inspection_result").insert(
      (templateItems ?? []).map((item) => ({
        inspection_id: inspection.inspection_id,
        template_item_id: item.template_item_id,
        category_snapshot: item.category,
        item_name_snapshot: item.item_name,
        display_order_snapshot: item.display_order,
        requires_measurement_snapshot: item.requires_measurement,
      }))
    );
  }

  return workOrder;
}

export async function processWixBookingWebhook(payload: {
  bookingId: string;
  locationId: string;
  createdByUserId?: string | null;
}): Promise<BookingWebhookResult> {
  const admin = createAdminClient();

  const { data: existingWo } = await admin
    .from("work_order")
    .select("work_order_id, work_order_number, customer_id")
    .eq("wix_booking_id", payload.bookingId)
    .maybeSingle();

  if (existingWo) {
    return {
      work_order_id: existingWo.work_order_id,
      work_order_number: existingWo.work_order_number,
      customer_id: existingWo.customer_id,
      created: false,
    };
  }

  let booking: WixBookingPayload;
  try {
    booking = await getWixBooking(payload.bookingId);
  } catch {
    booking = {
      bookingId: payload.bookingId,
      contact: {},
      serviceName: "Scheduled service",
      startDate: new Date().toISOString(),
    };
  }

  const customerId = await findOrCreateCustomerFromBooking(booking, admin);
  const motorcycleId = await findMotorcycleForCustomer(
    customerId,
    booking.formInfo,
    admin
  );

  if (!motorcycleId) {
    throw new Error("BOOKING_MOTORCYCLE_REQUIRED");
  }

  const scheduledAt = booking.startDate ?? new Date().toISOString();
  const internalNotes = `Wix booking ${payload.bookingId}${booking.serviceName ? ` — ${booking.serviceName}` : ""}`;

  const workOrder = await createBookingWorkOrder(admin, {
    motorcycleId,
    customerId,
    locationId: payload.locationId,
    bookingId: payload.bookingId,
    scheduledAt,
    internalNotes,
  });

  await addTimelineEvent(admin, {
    work_order_id: workOrder.work_order_id,
    user_id: payload.createdByUserId ?? null,
    event_type: TimelineEventType.WORK_ORDER_CREATED,
    entity_type: "work_order",
    entity_id: workOrder.work_order_id,
    description: "Work order created from Wix booking",
    new_value: {
      wix_booking_id: payload.bookingId,
      scheduled_at: scheduledAt,
      source: "wix_booking",
    },
  });

  await addAuditLog(admin, {
    actor_user_id: payload.createdByUserId ?? null,
    location_id: payload.locationId,
    action: "wix_booking_work_order_created",
    entity_type: "work_order",
    entity_id: workOrder.work_order_id,
    description: `WO ${workOrder.work_order_number} from Wix booking ${payload.bookingId}`,
    new_value: { wix_booking_id: payload.bookingId },
  });

  return {
    work_order_id: workOrder.work_order_id,
    work_order_number: workOrder.work_order_number,
    customer_id: customerId,
    created: true,
  };
}
