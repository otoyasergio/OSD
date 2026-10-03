import {
  emitPhotoTelemetry,
  safePhotoStatusClass,
  type PhotoThumbnailStage,
} from "@/lib/photos/telemetry";

export function logIntakeThumbnailFailure(details: {
  workOrderId?: string;
  photoId?: string;
  stage: PhotoThumbnailStage;
  statusCode?: string;
  message?: string;
}): void {
  const stage: PhotoThumbnailStage =
    details.stage === "generate" || details.stage === "upload"
      ? details.stage
      : "generate";
  emitPhotoTelemetry({
    name: "photo_thumbnail_failed",
    stage,
    statusClass: safePhotoStatusClass(details.statusCode),
  });
}
