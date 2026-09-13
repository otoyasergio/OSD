"use server";

import { revalidatePath } from "next/cache";
import {
  getKioskStaffClockState,
  kioskClockIn,
  kioskClockOut,
  kioskEndMeal,
  kioskStartMeal,
  listKioskStaff,
  verifyStaffPin,
  type KioskStaffRow,
  type KioskStaffSessionState,
} from "@/lib/services/timeClockKiosk";
import { toFormErrorMessage } from "@/lib/services/errors";

export type KioskActionResult =
  { ok: true; state?: KioskStaffSessionState } | { ok: false; error: string };

export async function listKioskStaffAction(): Promise<KioskStaffRow[]> {
  return listKioskStaff();
}

export async function verifyKioskPinAction(
  staffUserId: string,
  pin: string
): Promise<KioskActionResult> {
  try {
    await verifyStaffPin(staffUserId, pin);
    const state = await getKioskStaffClockState(staffUserId);
    return { ok: true, state };
  } catch (error) {
    return { ok: false, error: toFormErrorMessage(error) };
  }
}

async function afterKioskPunch(staffUserId: string): Promise<KioskActionResult> {
  revalidatePath("/kiosk");
  const state = await getKioskStaffClockState(staffUserId);
  return { ok: true, state };
}

export async function kioskClockInAction(
  staffUserId: string,
  pin: string,
  photoBase64: string
): Promise<KioskActionResult> {
  try {
    await kioskClockIn(staffUserId, pin, photoBase64);
    return afterKioskPunch(staffUserId);
  } catch (error) {
    return { ok: false, error: toFormErrorMessage(error) };
  }
}

export async function kioskClockOutAction(
  staffUserId: string,
  pin: string,
  photoBase64: string
): Promise<KioskActionResult> {
  try {
    await kioskClockOut(staffUserId, pin, photoBase64);
    return afterKioskPunch(staffUserId);
  } catch (error) {
    return { ok: false, error: toFormErrorMessage(error) };
  }
}

export async function kioskStartMealAction(
  staffUserId: string,
  pin: string,
  photoBase64: string
): Promise<KioskActionResult> {
  try {
    await kioskStartMeal(staffUserId, pin, photoBase64);
    return afterKioskPunch(staffUserId);
  } catch (error) {
    return { ok: false, error: toFormErrorMessage(error) };
  }
}

export async function kioskEndMealAction(
  staffUserId: string,
  pin: string,
  photoBase64: string
): Promise<KioskActionResult> {
  try {
    await kioskEndMeal(staffUserId, pin, photoBase64);
    return afterKioskPunch(staffUserId);
  } catch (error) {
    return { ok: false, error: toFormErrorMessage(error) };
  }
}
