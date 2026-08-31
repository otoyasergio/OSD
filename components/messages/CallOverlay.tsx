"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import {
  acceptCallAction,
  declineCallAction,
  endCallAction,
  getVideoCallRingInfoAction,
} from "@/app/(app)/messages/actions";
import { createClient } from "@/lib/database/supabase-browser";

export const VIDEO_CALL_EVENT = "otomoto-start-video-call";

const RING_TIMEOUT_MS = 30_000;

type IncomingCall = {
  call_id: string;
  callerName: string;
};

type Props = {
  currentUserId: string;
};

function CallOverlayInner({ currentUserId }: Props) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [pending, startTransition] = useTransition();
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roomRef = useRef<any>(null);

  const cleanupRoom = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    if (remoteRef.current) remoteRef.current.innerHTML = "";
    if (localRef.current) localRef.current.srcObject = null;
    setMuted(false);
    setCameraOff(false);
  }, []);

  const joinRoom = useCallback(
    async (callId: string) => {
      setError(null);
      setStatusLabel("Connecting video…");
      const res = await fetch("/api/calls/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId }),
      });
      const data = (await res.json()) as {
        token?: string;
        room_name?: string;
        error?: string;
      };
      if (!res.ok || !data.token || !data.room_name) {
        setError(data.error ?? "Could not join call.");
        setStatusLabel(null);
        return;
      }

      const Video = await import("twilio-video");
      const room = await Video.connect(data.token, {
        name: data.room_name,
        audio: true,
        video: true,
      });
      roomRef.current = room;
      setActiveCallId(callId);
      setIncoming(null);
      setStatusLabel(null);

      room.localParticipant.videoTracks.forEach((pub) => {
        if (localRef.current && pub.track) {
          pub.track.attach(localRef.current);
        }
      });

      const attachRemote = (participant: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tracks: Map<string, any>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        on: (event: string, cb: (pub: any) => void) => void;
      }) => {
        participant.tracks.forEach((publication) => {
          if (publication.track && remoteRef.current) {
            remoteRef.current.appendChild(publication.track.attach());
          }
        });
        participant.on("trackSubscribed", (track: { attach: () => HTMLElement }) => {
          if (remoteRef.current) {
            remoteRef.current.appendChild(track.attach());
          }
        });
      };

      room.participants.forEach(attachRemote);
      room.on("participantConnected", attachRemote);
      room.on("participantDisconnected", () => {
        if (room.participants.size === 0) {
          startTransition(async () => {
            await endCallAction(callId);
            cleanupRoom();
            setActiveCallId(null);
          });
        }
      });
      room.on("disconnected", () => {
        cleanupRoom();
        setActiveCallId(null);
      });
    },
    [cleanupRoom]
  );

  useEffect(() => {
    function onStart(event: Event) {
      const callId = (event as CustomEvent<{ callId?: string }>).detail?.callId;
      if (!callId) return;
      setIncoming(null);
      void joinRoom(callId);
    }
    window.addEventListener(VIDEO_CALL_EVENT, onStart);
    return () => window.removeEventListener(VIDEO_CALL_EVENT, onStart);
  }, [joinRoom]);

  useEffect(() => {
    if (!incoming) return;
    const timer = window.setTimeout(() => {
      startTransition(async () => {
        await declineCallAction(incoming.call_id);
        setIncoming(null);
      });
    }, RING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [incoming]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`user-video:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_call",
        },
        (payload) => {
          const row = payload.new as {
            call_id: string;
            kind: string;
            started_by_user_id: string | null;
            status: string;
          };
          if (
            row.kind !== "video" ||
            row.started_by_user_id === currentUserId ||
            row.status !== "ringing"
          ) {
            return;
          }
          void getVideoCallRingInfoAction(row.call_id).then((info) => {
            if (!info) return;
            setIncoming({
              call_id: row.call_id,
              callerName: info.callerName,
            });
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_call",
        },
        (payload) => {
          const row = payload.new as { call_id: string; status: string };
          if (row.status === "ended" || row.status === "missed") {
            setIncoming((current) => (current?.call_id === row.call_id ? null : current));
            if (activeCallId === row.call_id) {
              cleanupRoom();
              setActiveCallId(null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      cleanupRoom();
    };
  }, [currentUserId, cleanupRoom, activeCallId]);

  if (!incoming && !activeCallId) return null;

  return (
    <div className="comms-call-overlay" role="dialog" aria-label="Video call">
      <div className="comms-call-overlay-card comms-call-overlay-card--video">
        {incoming && !activeCallId ? (
          <div className="p-6 text-center">
            <p className="text-lg font-semibold">Incoming video call</p>
            <p className="mt-1 text-sm text-white/80">{incoming.callerName}</p>
            {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    await acceptCallAction(incoming.call_id);
                    await joinRoom(incoming.call_id);
                  });
                }}
              >
                Accept
              </button>
              <button
                type="button"
                className="btn"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    await declineCallAction(incoming.call_id);
                    setIncoming(null);
                  });
                }}
              >
                Decline
              </button>
            </div>
          </div>
        ) : (
          <div className="relative">
            <div
              ref={remoteRef}
              className="flex min-h-[280px] items-center justify-center bg-black [&>video]:max-h-[60vh] [&>video]:w-full"
            >
              {statusLabel ? (
                <p className="text-sm text-white/80">{statusLabel}</p>
              ) : null}
            </div>
            <video
              ref={localRef}
              autoPlay
              muted
              playsInline
              className="absolute bottom-4 right-4 h-28 w-40 rounded-lg border border-white/20 object-cover"
            />
            {error ? (
              <p className="p-3 text-center text-sm text-red-300">{error}</p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-3 p-4">
              <button
                type="button"
                className="btn"
                aria-pressed={muted}
                onClick={() => {
                  const room = roomRef.current;
                  if (!room) return;
                  const next = !muted;
                  setMuted(next);
                  room.localParticipant.audioTracks.forEach(
                    (pub: { track?: { disable: () => void; enable: () => void } }) => {
                      if (!pub.track) return;
                      if (next) pub.track.disable();
                      else pub.track.enable();
                    }
                  );
                }}
              >
                {muted ? "Unmute" : "Mute"}
              </button>
              <button
                type="button"
                className="btn"
                aria-pressed={cameraOff}
                onClick={() => {
                  const room = roomRef.current;
                  if (!room) return;
                  const next = !cameraOff;
                  setCameraOff(next);
                  room.localParticipant.videoTracks.forEach(
                    (pub: { track?: { disable: () => void; enable: () => void } }) => {
                      if (!pub.track) return;
                      if (next) pub.track.disable();
                      else pub.track.enable();
                    }
                  );
                }}
              >
                {cameraOff ? "Camera on" : "Camera off"}
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => {
                  startTransition(async () => {
                    if (activeCallId) await endCallAction(activeCallId);
                    cleanupRoom();
                    setActiveCallId(null);
                  });
                }}
              >
                End call
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export const CallOverlay = dynamic(() => Promise.resolve(CallOverlayInner), {
  ssr: false,
});
