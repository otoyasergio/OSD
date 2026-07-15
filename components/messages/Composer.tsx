"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  sendMessageAction,
  uploadChatImageAction,
  uploadVoiceNoteAction,
} from "@/app/(app)/messages/actions";

type Props = {
  conversationId: string;
  replyTo?: { message_id: string; preview: string } | null;
  onClearReply?: () => void;
};

export function Composer({ conversationId, replyTo, onClearReply }: Props) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function send() {
    const text = body.trim();
    if (!text) return;
    setError(null);
    startTransition(async () => {
      const result = await sendMessageAction(conversationId, text, replyTo?.message_id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody("");
      onClearReply?.();
    });
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    startTransition(async () => {
      const result = await uploadChatImageAction(conversationId, formData);
      if (result.error) setError(result.error);
    });
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const durationMs = Date.now() - startedAtRef.current;
        const file = new File([blob], `voice-${Date.now()}.webm`, {
          type: "audio/webm",
        });
        const formData = new FormData();
        formData.set("file", file);
        formData.set("duration_ms", String(durationMs));
        startTransition(async () => {
          const result = await uploadVoiceNoteAction(conversationId, formData);
          if (result.error) setError(result.error);
        });
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError("Microphone access is required for voice notes.");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--surface)] p-3">
      {replyTo ? (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm">
          <span className="truncate text-slate-600">Replying to: {replyTo.preview}</span>
          <button
            type="button"
            className="ml-2 text-slate-500 hover:text-slate-800"
            onClick={onClearReply}
          >
            ✕
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="mb-2 text-sm text-[var(--status-danger-fg)]">{error}</p>
      ) : null}
      <div className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={onFileChange}
        />
        <button
          type="button"
          className="btn shrink-0"
          disabled={pending}
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach photo"
        >
          +
        </button>
        <textarea
          className="input min-h-[2.75rem] flex-1 resize-none py-2"
          placeholder="Message"
          rows={1}
          value={body}
          disabled={pending}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className={`btn shrink-0 ${recording ? "btn-accent" : ""}`}
          disabled={pending}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onMouseLeave={() => {
            if (recording) stopRecording();
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            startRecording();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopRecording();
          }}
          aria-label="Hold to record voice note"
        >
          Mic
        </button>
        <button
          type="button"
          className="btn btn-primary shrink-0"
          disabled={pending || !body.trim()}
          onClick={send}
        >
          Send
        </button>
      </div>
    </div>
  );
}
