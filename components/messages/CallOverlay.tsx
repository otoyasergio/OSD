"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import {
  acceptCallAction,
  declineCallAction,
  endCallAction,
} from "@/app/(app)/messages/actions";
import { createClient } from "@/lib/database/supabase-browser";

type IncomingCall = {
  call_id: string;
  kind: "audio" | "video";
};

type Props = {
  currentUserId: string;
  outgoingCall?: { callId: string; kind: "audio" | "video" } | null;
  onOutgoingHandled?: () => void;
};

function CallOverlayInner({ currentUserId, outgoingCall, onOutgoingHandled }: Props) {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [activeCallId, setActiveCallId] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(true);
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const roomRef = useRef<any>(null);
  const audioMutedRef = useRef(false);
  const videoOffRef = useRef(false);

  const cleanupRoom = useCallback(() => {
    roomRef.current?.disconnect();
    roomRef.current = null;
    if (remoteRef.current) remoteRef.current.innerHTML = "";
    if (localRef.current) localRef.current.srcObject = null;
    audioMutedRef.current = false;
    videoOffRef.current = false;
  }, []);

  const joinRoom = useCallback(async (callId: string, video: boolean) => {
    setError(null);
    setStatusLabel(video ? "Connecting video…" : "Connecting audio…");
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
      video,
    });
    roomRef.current = room;
    setActiveCallId(callId);
    setIsVideo(video);
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
  }, []);

  useEffect(() => {
    if (!outgoingCall) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear incoming banner when placing outbound call
    setIncoming(null);
    void joinRoom(outgoingCall.callId, outgoingCall.kind === "video").finally(() =>
      onOutgoingHandled?.()
    );
  }, [outgoingCall, joinRoom, onOutgoingHandled]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`user:${currentUserId}`)
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
            kind: "audio" | "video";
            started_by_user_id: string | null;
            status: string;
          };
          if (row.started_by_user_id !== currentUserId && row.status === "ringing") {
            setIncoming({ call_id: row.call_id, kind: row.kind });
          }
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
      cleanupRoom();
    };
  }, [currentUserId, cleanupRoom]);

  if (!incoming && !activeCallId && !outgoingCall) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-[var(--chrome)] text-[var(--chrome-foreground)] shadow-2xl">
        {incoming && !activeCallId ? (
          <div className="p-6 text-center">
            <p className="text-lg font-semibold">
              Incoming {incoming.kind === "video" ? "video" : "audio"} call
            </p>
            {error ? <p className="mt-2 text-sm text-red-300">{error}</p> : null}
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    await acceptCallAction(incoming.call_id);
                    await joinRoom(incoming.call_id, incoming.kind === "video");
                    setIncoming(null);
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
            {isVideo ? (
              <video
                ref={localRef}
                autoPlay
                muted
                playsInline
                className="absolute bottom-4 right-4 h-28 w-40 rounded-lg border border-white/20 object-cover"
              />
            ) : null}
            {error ? (
              <p className="p-3 text-center text-sm text-red-300">{error}</p>
            ) : null}
            <div className="flex flex-wrap justify-center gap-3 p-4">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const room = roomRef.current;
                  if (!room) return;
                  audioMutedRef.current = !audioMutedRef.current;
                  room.localParticipant.audioTracks.forEach(
                    (pub: { track?: { disable: () => void; enable: () => void } }) => {
                      if (!pub.track) return;
                      if (audioMutedRef.current) pub.track.disable();
                      else pub.track.enable();
                    }
                  );
                }}
              >
                Mute
              </button>
              {isVideo ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const room = roomRef.current;
                    if (!room) return;
                    videoOffRef.current = !videoOffRef.current;
                    room.localParticipant.videoTracks.forEach(
                      (pub: { track?: { disable: () => void; enable: () => void } }) => {
                        if (!pub.track) return;
                        if (videoOffRef.current) pub.track.disable();
                        else pub.track.enable();
                      }
                    );
                  }}
                >
                  Camera
                </button>
              ) : null}
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
