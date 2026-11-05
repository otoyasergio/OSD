import "server-only";

import { requireUser } from "@/lib/auth/session";
import { shopDateKey, isStaffFeedbackSquashHour } from "@/lib/datetime/format";
import { createStaffFeedbackAdminClient } from "@/lib/database/supabase-admin";
import { createClient } from "@/lib/database/supabase-server";
import { canSubmitStaffFeedback, canViewAuditLog } from "@/lib/permissions";
import { signBucketPaths } from "@/lib/photos/signedUrls";
import { compressStaffFeedbackScreenshot } from "@/lib/staffFeedback/compressScreenshot";
import {
  STAFF_FEEDBACK_BUCKET,
  STAFF_FEEDBACK_SQUASH_BATCH,
} from "@/lib/staffFeedback/constants";
import {
  assertStaffFeedbackRate,
  normalizeStaffFeedbackNote,
  normalizeStaffFeedbackPath,
  normalizeStaffFeedbackViewport,
} from "@/lib/staffFeedback/fields";
import {
  buildStaffFeedbackArchive,
  planStaffFeedbackSquash,
  type StaffFeedbackArchiveReport,
} from "@/lib/staffFeedback/squish";

type AdminClient = ReturnType<typeof createStaffFeedbackAdminClient>;

type ActorEmbed =
  | { first_name: string | null; last_name: string | null }
  | { first_name: string | null; last_name: string | null }[]
  | null;

export type StaffFeedbackOpenReport = {
  reportId: string;
  createdAt: string;
  actorName: string;
  role: string;
  pagePath: string;
  note: string;
  screenshotUrl: string | null;
};

export type StaffFeedbackDigestView = {
  digestId: string;
  shopDate: string;
  createdAt: string;
  reportCount: number;
  summary: string;
  archiveBytes: number;
  archiveUrl: string | null;
};

export type StaffFeedbackSquashResult =
  | { ok: true; skipped: "outside_window" | "already_squashed" | "nothing_to_squash" }
  | {
      ok: true;
      shopDate: string;
      reportCount: number;
      archivePath: string;
      archiveBytes: number;
    };

function actorNameFromEmbed(actor: ActorEmbed): string {
  const row = Array.isArray(actor) ? actor[0] : actor;
  const name = `${row?.first_name ?? ""} ${row?.last_name ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
  return name || "Staff";
}

function isMissingObject(error: {
  message?: string;
  status?: number;
  statusCode?: number | string;
}): boolean {
  const status = Number(error.status ?? error.statusCode ?? 0);
  const message = (error.message ?? "").toLowerCase();
  return (
    status === 404 ||
    message.includes("not found") ||
    message.includes("object not found")
  );
}

function isAlreadySquashedError(error: { code?: string; message?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""}`;
  return text.includes("23505") || text.includes("staff_feedback_digest_shop_date");
}

async function zipExists(admin: AdminClient, archivePath: string): Promise<boolean> {
  const fileName = archivePath.split("/").pop();
  if (!fileName) return false;
  const { data, error } = await admin.storage
    .from(STAFF_FEEDBACK_BUCKET)
    .list("digests", {
      limit: 20,
      search: fileName,
    });
  if (error) throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");
  return (data ?? []).some((item) => item.name === fileName);
}

/** Remove loose pictures only after their day's zip is stored. */
async function clearArchivedScreenshots(admin: AdminClient): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await admin
      .from("staff_feedback_report")
      .select("report_id, screenshot_path, digest_id")
      .not("squashed_at", "is", null)
      .not("screenshot_path", "is", null)
      .limit(200);
    if (error) throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");
    const rows = (data ?? []).filter(
      (row) => row.screenshot_path && row.digest_id && row.report_id
    );
    if (rows.length === 0) return;

    const digestIds = [...new Set(rows.map((row) => row.digest_id as string))];
    const { data: digests, error: digestError } = await admin
      .from("staff_feedback_digest")
      .select("digest_id, archive_path")
      .in("digest_id", digestIds);
    if (digestError) throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");

    const ready = new Set<string>();
    for (const digest of digests ?? []) {
      if (await zipExists(admin, digest.archive_path)) ready.add(digest.digest_id);
    }
    const removable = rows.filter((row) => ready.has(row.digest_id as string));
    if (removable.length === 0) return;

    const paths = removable.map((row) => row.screenshot_path as string);
    const { error: removeError } = await admin.storage
      .from(STAFF_FEEDBACK_BUCKET)
      .remove(paths);
    if (removeError) throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");

    const { error: clearError } = await admin
      .from("staff_feedback_report")
      .update({ screenshot_path: null })
      .in(
        "report_id",
        removable.map((row) => row.report_id as string)
      );
    if (clearError) throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");
  }
}

async function downloadScreenshot(
  admin: AdminClient,
  path: string
): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(STAFF_FEEDBACK_BUCKET).download(path);
  if (error || !data) {
    if (error && isMissingObject(error)) return null;
    throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");
  }
  return new Uint8Array(await data.arrayBuffer());
}

async function rollbackSquash(admin: AdminClient, digestId: string, archivePath: string) {
  await admin
    .from("staff_feedback_report")
    .update({ digest_id: null, squashed_at: null })
    .eq("digest_id", digestId);
  await admin.from("staff_feedback_digest").delete().eq("digest_id", digestId);
  await admin.storage.from(STAFF_FEEDBACK_BUCKET).remove([archivePath]);
}

export async function submitStaffFeedback(input: {
  note: string;
  pagePath: string;
  viewportWidth: unknown;
  viewportHeight: unknown;
  screenshot: File | null;
}): Promise<void> {
  const note = normalizeStaffFeedbackNote(input.note);
  const pagePath = normalizeStaffFeedbackPath(input.pagePath);
  const viewportWidth = normalizeStaffFeedbackViewport(input.viewportWidth);
  const viewportHeight = normalizeStaffFeedbackViewport(input.viewportHeight);

  const user = await requireUser();
  if (!canSubmitStaffFeedback(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await supabase
    .from("staff_feedback_report")
    .select("report_id", { count: "exact", head: true })
    .eq("actor_user_id", user.user_id)
    .gte("created_at", since);
  if (countError) throw new Error("STAFF_FEEDBACK_SAVE_FAILED");
  assertStaffFeedbackRate(count ?? 0);

  const reportId = crypto.randomUUID();
  let screenshotPath: string | null = null;
  const file = input.screenshot;
  const hasPicture = file instanceof File && file.size > 0;

  if (hasPicture) {
    let compressed;
    try {
      compressed = await compressStaffFeedbackScreenshot(
        new Uint8Array(await file.arrayBuffer())
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "STAFF_FEEDBACK_SCREENSHOT_INVALID" ||
          error.message === "STAFF_FEEDBACK_SCREENSHOT_TOO_LARGE")
      ) {
        throw error;
      }
      throw new Error("STAFF_FEEDBACK_SCREENSHOT_INVALID");
    }
    screenshotPath = `${user.user_id}/${reportId}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(STAFF_FEEDBACK_BUCKET)
      .upload(screenshotPath, compressed.bytes, {
        contentType: "image/jpeg",
        upsert: false,
      });
    if (uploadError) throw new Error("STAFF_FEEDBACK_UPLOAD_FAILED");
  }

  const { error: insertError } = await supabase.from("staff_feedback_report").insert({
    report_id: reportId,
    actor_user_id: user.user_id,
    location_id: user.active_location_id,
    role: user.role,
    page_path: pagePath,
    note,
    viewport_width: viewportWidth,
    viewport_height: viewportHeight,
    had_screenshot: hasPicture,
    screenshot_path: screenshotPath,
  });

  if (insertError) {
    if (screenshotPath) {
      try {
        const admin = createStaffFeedbackAdminClient();
        await admin.storage.from(STAFF_FEEDBACK_BUCKET).remove([screenshotPath]);
      } catch {
        // The note was not saved. A leftover picture is removed on the next squash repair only
        // after a digest exists, so this object can remain until it is cleaned by hand.
      }
    }
    throw new Error("STAFF_FEEDBACK_SAVE_FAILED");
  }
}

export async function listStaffFeedbackBoard(): Promise<{
  openReports: StaffFeedbackOpenReport[];
  digests: StaffFeedbackDigestView[];
}> {
  const user = await requireUser();
  if (!canViewAuditLog(user.role)) throw new Error("FORBIDDEN");

  const supabase = await createClient();
  const [openResult, digestResult] = await Promise.all([
    supabase
      .from("staff_feedback_report")
      .select(
        `
        report_id,
        created_at,
        role,
        page_path,
        note,
        screenshot_path,
        actor:actor_user_id ( first_name, last_name )
      `
      )
      .is("squashed_at", null)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("staff_feedback_digest")
      .select(
        "digest_id, shop_date, created_at, report_count, summary, archive_bytes, archive_path"
      )
      .order("created_at", { ascending: false })
      .limit(60),
  ]);
  if (openResult.error || digestResult.error)
    throw new Error("STAFF_FEEDBACK_LOAD_FAILED");

  const screenshotPaths = (openResult.data ?? [])
    .map((row) => row.screenshot_path as string | null)
    .filter((path): path is string => Boolean(path));
  const archivePaths = (digestResult.data ?? [])
    .map((row) => row.archive_path as string | null)
    .filter((path): path is string => Boolean(path));
  const [screenshots, archives] = await Promise.all([
    signBucketPaths(supabase, STAFF_FEEDBACK_BUCKET, screenshotPaths),
    signBucketPaths(supabase, STAFF_FEEDBACK_BUCKET, archivePaths),
  ]);

  return {
    openReports: (openResult.data ?? []).map((row) => ({
      reportId: row.report_id as string,
      createdAt: row.created_at as string,
      actorName: actorNameFromEmbed(row.actor as ActorEmbed),
      role: row.role as string,
      pagePath: row.page_path as string,
      note: row.note as string,
      screenshotUrl: row.screenshot_path
        ? (screenshots.get(row.screenshot_path as string) ?? null)
        : null,
    })),
    digests: (digestResult.data ?? []).map((row) => ({
      digestId: row.digest_id as string,
      shopDate: row.shop_date as string,
      createdAt: row.created_at as string,
      reportCount: row.report_count as number,
      summary: row.summary as string,
      archiveBytes: row.archive_bytes as number,
      archiveUrl: archives.get(row.archive_path as string) ?? null,
    })),
  };
}

export async function squashStaffFeedback(
  now = new Date()
): Promise<StaffFeedbackSquashResult> {
  if (!isStaffFeedbackSquashHour(now)) return { ok: true, skipped: "outside_window" };

  const admin = createStaffFeedbackAdminClient();
  await clearArchivedScreenshots(admin);

  const shopDate = shopDateKey(now);
  if (!shopDate) throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");

  const { data: existing, error: existingError } = await admin
    .from("staff_feedback_digest")
    .select("digest_id")
    .eq("shop_date", shopDate)
    .maybeSingle();
  if (existingError) throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");

  const { data: openRows, error: openError } = await admin
    .from("staff_feedback_report")
    .select(
      `
      report_id,
      created_at,
      role,
      page_path,
      note,
      screenshot_path,
      actor:actor_user_id ( first_name, last_name )
    `
    )
    .is("squashed_at", null)
    .order("created_at", { ascending: true })
    .limit(STAFF_FEEDBACK_SQUASH_BATCH);
  if (openError) throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");

  const plan = planStaffFeedbackSquash({
    digestExists: Boolean(existing),
    reportCount: openRows?.length ?? 0,
  });
  if (plan.action !== "squash") return { ok: true, skipped: plan.action };

  const prepared: StaffFeedbackArchiveReport[] = [];
  for (const row of openRows ?? []) {
    const screenshot = row.screenshot_path
      ? await downloadScreenshot(admin, row.screenshot_path as string)
      : null;
    prepared.push({
      reportId: row.report_id as string,
      createdAt: row.created_at as string,
      actorName: actorNameFromEmbed(row.actor as ActorEmbed),
      role: row.role as string,
      pagePath: row.page_path as string,
      note: row.note as string,
      screenshot,
    });
  }

  const archive = buildStaffFeedbackArchive(prepared, shopDate);
  const { data: digestId, error: commitError } = await admin.rpc(
    "commit_staff_feedback_squash",
    {
      p_shop_date: shopDate,
      p_archive_path: archive.archivePath,
      p_summary: archive.summary,
      p_archive_bytes: archive.bytes.byteLength,
      p_report_ids: archive.reportIds,
    }
  );
  if (commitError || !digestId) {
    if (commitError && isAlreadySquashedError(commitError)) {
      return { ok: true, skipped: "already_squashed" };
    }
    throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");
  }

  const { error: uploadError } = await admin.storage
    .from(STAFF_FEEDBACK_BUCKET)
    .upload(archive.archivePath, Buffer.from(archive.bytes), {
      contentType: "application/zip",
      upsert: false,
    });
  if (uploadError) {
    await rollbackSquash(admin, digestId as string, archive.archivePath);
    throw new Error("STAFF_FEEDBACK_SQUASH_FAILED");
  }

  await clearArchivedScreenshots(admin);
  return {
    ok: true,
    shopDate,
    reportCount: archive.reportCount,
    archivePath: archive.archivePath,
    archiveBytes: archive.bytes.byteLength,
  };
}
