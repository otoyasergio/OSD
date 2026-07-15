export function staffAssignmentHref(workOrderId: string): string {
  return `/technician?wo=${encodeURIComponent(workOrderId)}`;
}
