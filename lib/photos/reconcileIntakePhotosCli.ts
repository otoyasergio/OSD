import {
  sortPhotoReconcileReport,
  type PhotoReconcileClient,
  type PhotoReconcileReport,
} from "@/lib/photos/reconcileIntakePhotos";

export type PhotoReconcileCliArgs = {
  repairThumbnails: boolean;
  json: boolean;
};

export function parsePhotoReconcileArgs(argv: string[]): PhotoReconcileCliArgs {
  return {
    repairThumbnails: argv.includes("--repair-thumbnails"),
    json: argv.includes("--json"),
  };
}

export function requirePhotoReconcileConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>
): { url: string; serviceRoleKey: string } {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceRoleKey) {
    throw new Error("PHOTO_ADMIN_MISCONFIGURED");
  }
  return { url, serviceRoleKey };
}

function lineList(title: string, count: number, lines: string[]): string {
  return [`${title}: ${count}`, ...lines.map((line) => `  ${line}`)].join("\n");
}

export function formatPhotoReconcileOutput(
  report: PhotoReconcileReport,
  options: { json: boolean }
): string {
  const normalized = sortPhotoReconcileReport(report);
  if (options.json) {
    return `${JSON.stringify(normalized)}\n`;
  }

  return [
    "Intake photo reconciliation",
    `Rows: ${normalized.counts.rows}  Objects: ${normalized.counts.objects}`,
    lineList(
      "Missing originals",
      normalized.counts.missingOriginals,
      normalized.missingOriginals.map((item) => `${item.photoId}  ${item.storagePath}`)
    ),
    lineList(
      "Missing recorded thumbnails",
      normalized.counts.missingThumbnails,
      normalized.missingThumbnails.map(
        (item) => `${item.photoId}  ${item.thumbStoragePath}`
      )
    ),
    lineList(
      "Null thumbnail pointers",
      normalized.counts.nullThumbnails,
      normalized.nullThumbnails.map((item) => `${item.photoId}  ${item.storagePath}`)
    ),
    lineList(
      "Orphans",
      normalized.counts.orphans,
      normalized.orphans.map((item) => item.path)
    ),
    `Repaired: ${normalized.counts.repaired}  Failed: ${normalized.counts.failed}`,
    "",
  ].join("\n");
}

export async function runPhotoReconcileCli<TClient = PhotoReconcileClient>(input: {
  argv: string[];
  env: NodeJS.ProcessEnv | Record<string, string | undefined>;
  write: (text: string) => void;
  createClient: () => TClient;
  reconcile: (
    client: TClient,
    options: { repairThumbnails: boolean }
  ) => Promise<PhotoReconcileReport>;
}): Promise<number> {
  const args = parsePhotoReconcileArgs(input.argv);
  requirePhotoReconcileConfig(input.env);
  const client = input.createClient();
  const report = await input.reconcile(client, {
    repairThumbnails: args.repairThumbnails,
  });
  input.write(formatPhotoReconcileOutput(report, { json: args.json }));
  return 0;
}
