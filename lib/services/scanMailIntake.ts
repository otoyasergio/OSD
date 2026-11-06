import { createAdminClient } from "@/lib/database/supabase-admin";
import { getGmailOAuthConfig } from "@/lib/email/config";
import {
  listScanMailboxes,
  updateScanMailboxRefreshToken,
} from "@/lib/email/scanMailbox";
import { listUnreadPdfMessageIds, readUnreadScanMail } from "@/lib/email/scanInbox";
import {
  filingsForUnreadMail,
  needsLookForUnreadPdf,
  type ScanBike,
  type WaitingInspection,
} from "@/lib/email/scanReport";
import { applyEmptyReportedMileage } from "@/lib/services/inspectionScans";

type WorkOrderRow = {
  work_order_id: string;
  work_order_number: string;
  motorcycle_id: string;
  motorcycle: { vin?: string | null } | Array<{ vin?: string | null }> | null;
};

function vinOf(
  motorcycle: { vin?: string | null } | Array<{ vin?: string | null }> | null
): string | null {
  const row = Array.isArray(motorcycle) ? motorcycle[0] : motorcycle;
  return row?.vin ?? null;
}

async function waitingInspections(locationId: string): Promise<WaitingInspection[]> {
  const admin = createAdminClient();
  const { data: orders, error: orderError } = await admin
    .from("work_order")
    .select(
      "work_order_id, work_order_number, motorcycle_id, motorcycle:motorcycle_id(vin)"
    )
    .eq("location_id", locationId)
    .not("status", "in", "(completed,cancelled)");
  if (orderError) throw orderError;
  const workOrders = (orders ?? []) as WorkOrderRow[];
  if (workOrders.length === 0) return [];

  const { data: inspections, error } = await admin
    .from("inspection")
    .select("inspection_id, work_order_id")
    .in(
      "work_order_id",
      workOrders.map((row) => row.work_order_id)
    )
    .is("completed_at", null);
  if (error) throw error;

  const byWorkOrder = new Map(workOrders.map((row) => [row.work_order_id, row]));
  return ((inspections ?? []) as Array<{ inspection_id: string; work_order_id: string }>)
    .map((inspection) => {
      const workOrder = byWorkOrder.get(inspection.work_order_id);
      if (!workOrder) return null;
      return {
        inspectionId: inspection.inspection_id,
        workOrderId: workOrder.work_order_id,
        workOrderNumber: workOrder.work_order_number,
        motorcycleId: workOrder.motorcycle_id,
        vin: vinOf(workOrder.motorcycle),
      };
    })
    .filter((row): row is WaitingInspection => row !== null);
}

async function bikesForScan(): Promise<ScanBike[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("motorcycle")
    .select("motorcycle_id, vin")
    .not("vin", "is", null);
  if (error) throw error;
  return ((data ?? []) as Array<{ motorcycle_id: string; vin: string | null }>).map(
    (row) => ({
      motorcycleId: row.motorcycle_id,
      vin: row.vin,
    })
  );
}

export async function ingestScanMail(): Promise<{ filed: number; held: number }> {
  const mailboxes = await listScanMailboxes();
  if (mailboxes.length === 0) return { filed: 0, held: 0 };
  const bikes = await bikesForScan();

  const config = getGmailOAuthConfig();
  const admin = createAdminClient();
  let filed = 0;
  let held = 0;

  for (const mailbox of mailboxes) {
    const listed = await listUnreadPdfMessageIds({
      refreshToken: mailbox.refreshToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    if (listed.refreshToken) {
      await updateScanMailboxRefreshToken(mailbox.locationId, listed.refreshToken);
    }
    if (listed.ids.length === 0) continue;

    const { data: existing, error: existingError } = await admin
      .from("scan_report")
      .select("gmail_message_id")
      .eq("location_id", mailbox.locationId)
      .in("gmail_message_id", listed.ids);
    if (existingError) throw existingError;
    const alreadyFiledIds = ((existing ?? []) as Array<{ gmail_message_id: string }>).map(
      (row) => row.gmail_message_id
    );
    const freshIds = listed.ids.filter((id) => !alreadyFiledIds.includes(id));
    if (freshIds.length === 0) continue;

    const read = await readUnreadScanMail({
      refreshToken: mailbox.refreshToken,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accessToken: listed.accessToken,
      messageIds: freshIds,
    });

    const waiting = await waitingInspections(mailbox.locationId);
    const planned = filingsForUnreadMail({
      messages: read.messages.map((message) => ({
        id: message.id,
        text: [message.subject, message.text].filter(Boolean).join("\n"),
      })),
      waiting,
      bikes,
      alreadyFiledIds,
    });
    const plannedById = new Map(planned.map((row) => [row.gmailMessageId, row]));

    for (const message of read.messages) {
      const text = [message.subject, message.text].filter(Boolean).join("\n");
      const row =
        plannedById.get(message.id) ?? needsLookForUnreadPdf({ id: message.id, text });
      if (!row) continue;
      const { error } = await admin.from("scan_report").insert({
        location_id: mailbox.locationId,
        gmail_message_id: row.gmailMessageId,
        subject: message.subject.slice(0, 500),
        from_address: message.from.slice(0, 320),
        outcome: row.outcome,
        vin_in_report: row.vin,
        codes: row.codes,
        report_text: row.reportText,
        inspection_id: row.inspectionId,
        work_order_id: row.workOrderId,
        motorcycle_id: row.motorcycleId,
      });
      if (error && error.code !== "23505") throw error;
      if (row.workOrderId) {
        await applyEmptyReportedMileage(admin, row.workOrderId, row.reportText);
      }
      if (row.workOrderId || row.motorcycleId) filed += 1;
      else held += 1;
    }
  }

  return { filed, held };
}
