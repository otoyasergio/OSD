export type PhoneCallStatus =
  "ringing" | "in_progress" | "completed" | "missed" | "no_answer" | "busy" | "failed";

export function mapTwilioCallStatus(
  callStatus: string | null | undefined,
  options?: { direction?: "inbound" | "outbound" }
): PhoneCallStatus | null {
  switch ((callStatus ?? "").toLowerCase()) {
    case "queued":
    case "ringing":
      return "ringing";
    case "in-progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "busy":
      return "busy";
    case "failed":
    case "canceled":
    case "cancelled":
      return "failed";
    case "no-answer":
      return options?.direction === "inbound" ? "missed" : "no_answer";
    default:
      return null;
  }
}
