"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppUser } from "@/lib/auth/session";
import { canUseShopPhone } from "@/lib/permissions/checks";
import {
  clearVoicePresenceAction,
  heartbeatVoicePresenceAction,
  preparePstnCallAction,
  prepareStaffCallAction,
} from "@/app/(app)/messages/voice-actions";

type IncomingVoice = {
  call: VoiceCallHandle;
  callerName: string;
  channel: "pstn" | "staff";
};

type ActiveVoice = {
  call: VoiceCallHandle;
  label: string;
  muted: boolean;
};

type VoiceCallHandle = {
  accept: () => void;
  reject: () => void;
  disconnect: () => void;
  mute: (muted?: boolean) => boolean;
  on: (event: string, listener: (...args: never[]) => void) => void;
  status: () => string;
  customParameters?: Map<string, string>;
  parameters?: Record<string, string>;
};

type ShopVoiceContextValue = {
  canPlacePstn: boolean;
  deviceReady: boolean;
  incoming: IncomingVoice | null;
  active: ActiveVoice | null;
  error: string | null;
  placePstnCall: (input: {
    to?: string | null;
    customerId?: string | null;
    workOrderId?: string | null;
  }) => Promise<void>;
  placeStaffCall: (conversationId: string) => Promise<void>;
  acceptIncoming: () => void;
  declineIncoming: () => void;
  toggleMute: () => void;
  hangup: () => void;
};

const ShopVoiceContext = createContext<ShopVoiceContextValue | null>(null);

function callerNameFromCall(call: VoiceCallHandle): {
  name: string;
  channel: "pstn" | "staff";
} {
  const params = call.customParameters;
  const name = params?.get("callerName") ?? params?.get("CallerName");
  const from = call.parameters?.From ?? "";
  const channel: "pstn" | "staff" = from.startsWith("client:") ? "staff" : "pstn";
  return { name: name || from || "Incoming call", channel };
}

export function ShopVoiceProvider({
  user,
  children,
}: {
  user: AppUser;
  children: React.ReactNode;
}) {
  const canPlacePstn = canUseShopPhone(user.role);
  const [deviceReady, setDeviceReady] = useState(false);
  const [incoming, setIncoming] = useState<IncomingVoice | null>(null);
  const [active, setActive] = useState<ActiveVoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deviceRef = useRef<{
    register: () => Promise<void>;
    destroy: () => void;
    updateToken: (token: string) => void;
    connect: (options: { params: Record<string, string> }) => Promise<VoiceCallHandle>;
    on: (event: string, listener: (...args: never[]) => void) => void;
  } | null>(null);
  const ringtoneStopRef = useRef<(() => void) | null>(null);

  const stopRingtone = useCallback(() => {
    ringtoneStopRef.current?.();
    ringtoneStopRef.current = null;
  }, []);

  const startRingtone = useCallback(() => {
    stopRingtone();
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    let cancelled = false;
    const beep = () => {
      if (cancelled) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 480;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    };
    beep();
    const timer = window.setInterval(beep, 1400);
    ringtoneStopRef.current = () => {
      cancelled = true;
      window.clearInterval(timer);
      void ctx.close();
    };
  }, [stopRingtone]);

  const bindCall = useCallback(
    (call: VoiceCallHandle, label: string) => {
      setActive({ call, label, muted: false });
      call.on("disconnect", () => {
        setActive(null);
        stopRingtone();
      });
      call.on("cancel", () => {
        setIncoming(null);
        stopRingtone();
      });
      call.on("reject", () => {
        setIncoming(null);
        stopRingtone();
      });
    },
    [stopRingtone]
  );

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;
    let heartbeatTimer: number | undefined;

    async function setup() {
      const res = await fetch("/api/calls/voice-token", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!cancelled) setError(body.error ?? "Shop phone is unavailable.");
        return;
      }
      const data = (await res.json()) as { token: string; ttl: number };
      const sdk = await import("@twilio/voice-sdk");
      if (cancelled) return;
      const device = new sdk.Device(data.token, {
        logLevel: "error",
        closeProtection: true,
      });
      deviceRef.current = device as unknown as NonNullable<typeof deviceRef.current>;

      device.on("registered", () => {
        setDeviceReady(true);
        setError(null);
        void heartbeatVoicePresenceAction();
      });
      device.on("unregistered", () => setDeviceReady(false));
      device.on("error", (err: { message?: string }) => {
        setError(err.message ?? "Shop phone error");
      });
      device.on("incoming", (call: VoiceCallHandle) => {
        const meta = callerNameFromCall(call);
        if (meta.channel === "pstn" && !canUseShopPhone(user.role)) {
          call.reject();
          return;
        }
        setIncoming({ call, callerName: meta.name, channel: meta.channel });
        startRingtone();
        call.on("cancel", () => {
          setIncoming((current) => (current?.call === call ? null : current));
          stopRingtone();
        });
      });

      await device.register();
      // Self-rescheduling token refresh: a one-shot timer would let the token
      // expire ~2h in and silently kill the shop phone on an open tab, and a
      // network blip must retry rather than give up.
      const scheduleTokenRefresh = (ttlSeconds: number) => {
        if (cancelled) return;
        refreshTimer = window.setTimeout(
          () => {
            void (async () => {
              try {
                const r = await fetch("/api/calls/voice-token", { method: "POST" });
                if (cancelled) return;
                if (r.ok) {
                  const body = (await r.json()) as { token?: string; ttl?: number };
                  if (body.token) {
                    device.updateToken(body.token);
                    scheduleTokenRefresh(body.ttl ?? 3600);
                    return;
                  }
                }
              } catch {
                // Network blip — fall through to the short retry below.
              }
              scheduleTokenRefresh(0); // clamps to the 60s minimum
            })();
          },
          Math.max(60_000, (ttlSeconds - 300) * 1000)
        );
      };
      scheduleTokenRefresh(data.ttl);
      heartbeatTimer = window.setInterval(() => {
        void heartbeatVoicePresenceAction();
      }, 30_000);
    }

    void setup();
    return () => {
      cancelled = true;
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (heartbeatTimer) window.clearInterval(heartbeatTimer);
      stopRingtone();
      void clearVoicePresenceAction();
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, [user.user_id, user.active_location_id, startRingtone, stopRingtone, user.role]);

  const placePstnCall = useCallback(
    async (input: {
      to?: string | null;
      customerId?: string | null;
      workOrderId?: string | null;
    }) => {
      setError(null);
      const prepared = await preparePstnCallAction(input);
      if (prepared.error || !prepared.phoneCallId || !prepared.to) {
        setError(prepared.error ?? "Could not start the call.");
        return;
      }
      const device = deviceRef.current;
      if (!device) {
        setError("Shop phone is not ready yet.");
        return;
      }
      const call = await device.connect({
        params: {
          CallType: "pstn",
          PhoneCallId: prepared.phoneCallId,
          To: prepared.to,
          CustomerId: input.customerId ?? "",
          WorkOrderId: input.workOrderId ?? "",
          LocationId: user.active_location_id ?? "",
        },
      });
      bindCall(call, prepared.customerName || prepared.to);
    },
    [bindCall, user.active_location_id]
  );

  const placeStaffCall = useCallback(
    async (conversationId: string) => {
      setError(null);
      const prepared = await prepareStaffCallAction(conversationId);
      if (prepared.error || !prepared.phoneCallId) {
        setError(prepared.error ?? "Could not start the call.");
        return;
      }
      const device = deviceRef.current;
      if (!device) {
        setError("Shop phone is not ready yet.");
        return;
      }
      const toUserId = prepared.toUserIds?.[0] ?? "";
      const call = await device.connect({
        params: {
          CallType: "staff",
          PhoneCallId: prepared.phoneCallId,
          ConversationId: conversationId,
          ToUserId: toUserId,
        },
      });
      bindCall(call, prepared.displayName || "Staff");
    },
    [bindCall]
  );

  const acceptIncoming = useCallback(() => {
    if (!incoming) return;
    incoming.call.accept();
    bindCall(incoming.call, incoming.callerName);
    setIncoming(null);
    stopRingtone();
  }, [incoming, bindCall, stopRingtone]);

  const declineIncoming = useCallback(() => {
    incoming?.call.reject();
    setIncoming(null);
    stopRingtone();
  }, [incoming, stopRingtone]);

  const toggleMute = useCallback(() => {
    setActive((current) => {
      if (!current) return current;
      const muted = !current.muted;
      current.call.mute(muted);
      return { ...current, muted };
    });
  }, []);

  const hangup = useCallback(() => {
    active?.call.disconnect();
    setActive(null);
    stopRingtone();
  }, [active, stopRingtone]);

  const value = useMemo<ShopVoiceContextValue>(
    () => ({
      canPlacePstn,
      deviceReady,
      incoming,
      active,
      error,
      placePstnCall,
      placeStaffCall,
      acceptIncoming,
      declineIncoming,
      toggleMute,
      hangup,
    }),
    [
      canPlacePstn,
      deviceReady,
      incoming,
      active,
      error,
      placePstnCall,
      placeStaffCall,
      acceptIncoming,
      declineIncoming,
      toggleMute,
      hangup,
    ]
  );

  return (
    <ShopVoiceContext.Provider value={value}>
      {children}
      {incoming || active ? (
        <div className="comms-call-overlay" role="dialog" aria-label="Phone call">
          <div className="comms-call-overlay-card">
            {incoming && !active ? (
              <>
                <p className="text-lg font-semibold">
                  Incoming {incoming.channel === "pstn" ? "shop" : "staff"} call
                </p>
                <p className="mt-1 text-sm text-white/80">{incoming.callerName}</p>
                <div className="mt-6 flex justify-center gap-3">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={acceptIncoming}
                  >
                    Accept
                  </button>
                  <button type="button" className="btn" onClick={declineIncoming}>
                    Decline
                  </button>
                </div>
              </>
            ) : active ? (
              <>
                <p className="text-lg font-semibold">{active.label}</p>
                <p className="mt-1 text-sm text-white/70">On a call</p>
                <div className="mt-6 flex justify-center gap-3">
                  <button type="button" className="btn" onClick={toggleMute}>
                    {active.muted ? "Unmute" : "Mute"}
                  </button>
                  <button type="button" className="btn btn-accent" onClick={hangup}>
                    End
                  </button>
                </div>
              </>
            ) : null}
            {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
          </div>
        </div>
      ) : error ? (
        <p className="sr-only">{error}</p>
      ) : null}
    </ShopVoiceContext.Provider>
  );
}

export function useShopVoice(): ShopVoiceContextValue {
  const value = useContext(ShopVoiceContext);
  if (!value) throw new Error("ShopVoiceProvider is required");
  return value;
}

export function useShopVoiceOptional(): ShopVoiceContextValue | null {
  return useContext(ShopVoiceContext);
}
