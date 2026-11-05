import { exceedsServerActionUploadLimit } from "@/lib/forms/uploadLimits";

function excludesFeedbackChrome(node: Node): boolean {
  if (!(node instanceof Element)) return true;
  return node.closest("[data-staff-feedback]") == null;
}

function canvasToJpeg(source: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    source.toBlob((blob) => resolve(blob), "image/jpeg", 0.72);
  });
}

async function shrinkUntilUploadable(source: HTMLCanvasElement): Promise<Blob | null> {
  let canvas = source;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const blob = await canvasToJpeg(canvas);
    if (!blob) return null;
    if (!exceedsServerActionUploadLimit(blob)) return blob;
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(canvas.width * 0.7));
    next.height = Math.max(1, Math.round(canvas.height * 0.7));
    const context = next.getContext("2d");
    if (!context) return null;
    context.drawImage(canvas, 0, 0, next.width, next.height);
    canvas = next;
  }
  return null;
}

/**
 * A failed foreignObject paint comes back as a blank white canvas. A real
 * workshop screen always has some ink, so a near-white result is a miss.
 */
function canvasHasInk(canvas: HTMLCanvasElement): boolean {
  const sample = document.createElement("canvas");
  sample.width = 32;
  sample.height = 32;
  const context = sample.getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  context.drawImage(canvas, 0, 0, sample.width, sample.height);
  const data = context.getImageData(0, 0, sample.width, sample.height).data;
  let ink = 0;
  for (let index = 0; index < data.length; index += 4) {
    if (data[index] < 250 || data[index + 1] < 250 || data[index + 2] < 250) {
      ink += 1;
    }
  }
  return ink >= 12;
}

/** Picture of the visible screen, with the report button left out. Null when capture fails. */
export async function captureStaffFeedbackScreenshot(): Promise<Blob | null> {
  if (typeof document === "undefined") return null;
  try {
    const { domToCanvas } = await import("modern-screenshot");
    const width = Math.max(1, document.documentElement.clientWidth || window.innerWidth);
    const height = Math.max(
      1,
      document.documentElement.clientHeight || window.innerHeight
    );
    const canvas = await domToCanvas(document.body, {
      width,
      height,
      scale: 1,
      backgroundColor: "#ffffff",
      timeout: 8000,
      font: false,
      filter: excludesFeedbackChrome,
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        transformOrigin: "top left",
      },
    });
    if (!canvasHasInk(canvas)) return null;
    return await shrinkUntilUploadable(canvas);
  } catch {
    return null;
  }
}
