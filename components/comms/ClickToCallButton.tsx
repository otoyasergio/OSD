"use client";

import { Phone } from "lucide-react";
import { useShopVoiceOptional } from "@/components/comms/ShopVoiceProvider";

export function ClickToCallButton({
  phone,
  customerId,
  workOrderId,
  customerName,
  visible = true,
}: {
  phone: string | null | undefined;
  customerId?: string | null;
  workOrderId?: string | null;
  customerName?: string | null;
  visible?: boolean;
}) {
  const voice = useShopVoiceOptional();
  if (!visible || !voice?.canPlacePstn || !phone) return null;

  return (
    <button
      type="button"
      className="btn btn-secondary min-h-10 text-sm"
      disabled={!voice.deviceReady}
      title={customerName ? `Call ${customerName}` : "Call"}
      onClick={() => {
        void voice.placePstnCall({ to: phone, customerId, workOrderId });
      }}
    >
      <Phone className="mr-1.5 h-4 w-4" aria-hidden />
      Call
    </button>
  );
}
