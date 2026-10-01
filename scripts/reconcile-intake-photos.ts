#!/usr/bin/env npx tsx
/**
 * Intake photo reconciliation (report-only by default).
 *
 *   npm run photos:reconcile
 *   npm run photos:reconcile -- --repair-thumbnails
 *   npm run photos:reconcile -- --json
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
 * CLI process only. Never deletes objects. Do not point this at production
 * unless you intend a read-only inventory.
 */
import { createPhotoAdminClient } from "../lib/database/supabase-admin";
import { reconcileIntakePhotosWithClient } from "../lib/photos/reconcileIntakePhotos";
import { runPhotoReconcileCli } from "../lib/photos/reconcileIntakePhotosCli";

const code = await runPhotoReconcileCli({
  argv: process.argv.slice(2),
  env: process.env,
  write: (text) => {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  },
  createClient: createPhotoAdminClient,
  reconcile: reconcileIntakePhotosWithClient,
});

process.exit(code);
