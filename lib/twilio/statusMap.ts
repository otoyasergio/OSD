/**
 * Map Twilio MessageStatus → communication_log.status values.
 * Schema allows: queued | sent | delivered | failed | received
 */
export function mapTwilioMessageStatus(
  messageStatus: string | null | undefined
): "queued" | "sent" | "delivered" | "failed" | null {
  switch ((messageStatus ?? "").toLowerCase()) {
    case "queued":
    case "accepted":
    case "scheduled":
      return "queued";
    case "sending":
    case "sent":
      return "sent";
    case "delivered":
    case "read":
      return "delivered";
    case "failed":
    case "undelivered":
    case "canceled":
    case "cancelled":
      return "failed";
    default:
      return null;
  }
}
