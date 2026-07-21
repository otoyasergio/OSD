"use server";

import { revalidatePath } from "next/cache";
import {
  assignAllActiveJobsOnWorkOrderToTechnician,
  openWorkOrderForControlCenter,
  unassignAllActiveJobsOnWorkOrder,
} from "@/lib/services/jobs";
import { clockStaffIn, clockStaffOut } from "@/lib/services/timeClock";
import { recordUxFailure } from "@/lib/services/uxEvents";

function revalidateDispatch() {
  revalidatePath("/control-center");
  revalidatePath("/technician");
  revalidatePath("/technician/docket");
  revalidatePath("/dashboard");
}

export async function dispatchWorkOrderToTechnicianAction(
  workOrderId: string,
  technicianId: string
): Promise<{ error: string | null }> {
  try {
    await assignAllActiveJobsOnWorkOrderToTechnician(workOrderId, technicianId);
    revalidateDispatch();
    return { error: null };
  } catch (error) {
    return {
      error: await recordUxFailure(error, {
        source: "control_center.dispatch",
        context: { work_order_id: workOrderId, technician_id: technicianId },
      }),
    };
  }
}

export async function unassignWorkOrderJobsAction(
  workOrderId: string
): Promise<{ error: string | null }> {
  try {
    await unassignAllActiveJobsOnWorkOrder(workOrderId);
    revalidateDispatch();
    return { error: null };
  } catch (error) {
    return {
      error: await recordUxFailure(error, {
        source: "control_center.unassign",
        context: { work_order_id: workOrderId },
      }),
    };
  }
}

export async function openWorkOrderAction(
  workOrderId: string
): Promise<{ error: string | null; opened_at?: string }> {
  try {
    const result = await openWorkOrderForControlCenter(workOrderId);
    revalidatePath("/control-center");
    return { error: null, opened_at: result.opened_at };
  } catch (error) {
    return {
      error: await recordUxFailure(error, {
        source: "control_center.open",
        context: { work_order_id: workOrderId },
      }),
    };
  }
}

export async function setStaffSignedInAction(
  staffUserId: string,
  signedIn: boolean
): Promise<{ error: string | null }> {
  try {
    if (signedIn) {
      await clockStaffIn(staffUserId);
    } else {
      await clockStaffOut(staffUserId);
    }
    revalidatePath("/control-center");
    revalidatePath("/technician");
    revalidatePath("/settings/timesheets");
    return { error: null };
  } catch (error) {
    return {
      error: await recordUxFailure(error, {
        source: signedIn ? "control_center.staff_in" : "control_center.staff_out",
        context: { staff_user_id: staffUserId },
      }),
    };
  }
}
