export type PhoneCallStatus =
  "ringing" | "in_progress" | "completed" | "missed" | "no_answer" | "busy" | "failed";

export function mapTwilioCallStatus(
  callStatus: string | null | undefined
): PhoneCallStatus | null {
  switch ((callStatus ?? "").toLowerCase()) {
    case "queued":
    case "initiated":
    case "ringing":
      return "ringing";
    case "in-progress":
    case "answered":
      return "in_progress";
    case "completed":
      return "completed";
    case "busy":
      return "busy";
    case "no-answer":
      return "no_answer";
    case "canceled":
    case "cancelled":
      return "missed";
    case "failed":
      return "failed";
    default:
      return null;
  }
}
