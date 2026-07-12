"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  onChange: (dataUrl: string | null) => void;
  height?: number;
};

export function SignatureCanvas({ onChange, height = 180 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, []);

  function pointerPos(
    event: React.PointerEvent<HTMLCanvasElement>
  ): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function emitChange() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL("image/png"));
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    const { x, y } = pointerPos(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { x, y } = pointerPos(event);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    canvasRef.current?.releasePointerCapture(event.pointerId);
    emitChange();
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        width={800}
        height={height * 2}
        className="w-full touch-none rounded border border-zinc-300 bg-white"
        style={{ height }}
        aria-label="Signature pad"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      <button type="button" className="btn btn-secondary self-start" onClick={clear}>
        Clear signature
      </button>
    </div>
  );
}
