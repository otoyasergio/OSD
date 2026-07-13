"use client";

import { useEffect, useRef } from "react";

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

    const setup = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
    };

    setup();
    const observer = new ResizeObserver(setup);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [height]);

  function pointerPos(event: React.PointerEvent<HTMLCanvasElement>): {
    x: number;
    y: number;
  } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
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
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    onChange(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvasRef}
        className="w-full touch-none rounded border border-[var(--border-strong)] bg-white"
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
