const BOX_ID = /^TM-BL-[0-9]{4}$/;

export function parseBoxId(
  raw: string
): { ok: true; boxId: string } | { ok: false; error: string } {
  const boxId = raw.trim();
  if (!BOX_ID.test(boxId)) {
    return { ok: false, error: "Box id looks like TM-BL-0007." };
  }
  return { ok: true, boxId };
}
