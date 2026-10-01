import {
  describePhotoUploadFailure,
  photoTooLargeMessage,
} from "@/lib/forms/photoUploadErrors";
import { withPhotoUploadRetries } from "@/lib/forms/retryPhotoUpload";
import { exceedsServerActionUploadLimit } from "@/lib/forms/uploadLimits";

export type UploadOneResult = { error?: string | null } | null | undefined;

export type UploadPhotosIndividuallyOutcome = {
  total: number;
  uploaded: number;
  failed: number;
  /** First failure, already user-facing. `null` when everything uploaded. */
  error: string | null;
  /** Per-file outcome in input order. */
  results: { file: File; error: string | null }[];
};

export type UploadPhotosIndividuallyOptions = {
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
};

/**
 * Send several photos as one Server Action call **per photo**.
 *
 * A multi-file `<input multiple>` submitted as a single form POST puts every
 * photo in one request body, and Vercel refuses bodies over 4.5 MB before the
 * app runs — two bike photos are enough to hit that. Splitting keeps each
 * request under the cap, lets a single bad photo fail without losing the rest,
 * and gives transient failures a retry.
 */
export async function uploadPhotosIndividually(
  files: File[],
  run: (file: File) => Promise<UploadOneResult>,
  options: UploadPhotosIndividuallyOptions = {}
): Promise<UploadPhotosIndividuallyOutcome> {
  const results: UploadPhotosIndividuallyOutcome["results"] = [];

  for (const file of files) {
    if (exceedsServerActionUploadLimit(file)) {
      results.push({ file, error: photoTooLargeMessage(file) });
      continue;
    }

    const result = await withPhotoUploadRetries(
      async () => {
        try {
          const value = await run(file);
          return { error: value?.error ?? null };
        } catch (error) {
          return { error: describePhotoUploadFailure(error) };
        }
      },
      {
        isSuccess: (value) => !value.error,
        getFailureMessage: (value) => value.error,
        sleep: options.sleep,
        attempts: options.attempts,
      }
    );
    results.push({ file, error: result.error ?? null });
  }

  const failed = results.filter((result) => result.error !== null);
  return {
    total: files.length,
    uploaded: results.length - failed.length,
    failed: failed.length,
    error: failed[0]?.error ?? null,
    results,
  };
}

/**
 * One line for the floor / documents status area, e.g.
 * "3 photos uploaded." or "2 of 3 photos uploaded. That photo is 6.1 MB — …".
 */
export function describeUploadOutcome(
  outcome: UploadPhotosIndividuallyOutcome,
  noun = "photo"
): string {
  const plural = (count: number) => (count === 1 ? noun : `${noun}s`);
  if (outcome.failed === 0) {
    return outcome.total === 1
      ? `${capitalize(noun)} uploaded.`
      : `${outcome.total} ${plural(outcome.total)} uploaded.`;
  }
  const reason = outcome.error ?? "";
  if (outcome.uploaded === 0) {
    return outcome.total === 1
      ? reason
      : `None of the ${outcome.total} ${plural(outcome.total)} uploaded. ${reason}`.trim();
  }
  return `${outcome.uploaded} of ${outcome.total} ${plural(outcome.total)} uploaded. ${reason}`.trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
