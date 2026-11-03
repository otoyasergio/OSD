/**
 * SAE J2012 / ISO 14229-1 Annex D trouble-code bytes.
 *
 * The bit layout is the one in `encode_dtc` from the Apache-2.0 sample
 * aws-solutions-library-samples/guidance-for-connected-mobility-on-aws
 * (`services/simulation/uds_dtc_responder.py`). Copyright Amazon.com, Inc.
 * or its affiliates. All Rights Reserved.
 *
 * System names follow that sample's DTC category notes
 * (`services/_shared/dtc_suggestions.py`). The car routine list in that file
 * is not used. This shop does not clear codes and does not run actuator tests.
 */

const SAE_CODE = /^[PCBU][0-3][0-9A-F]{3}$/;
const LETTERS = "PCBU";
const HEX = "0123456789ABCDEF";

/** testFailed (bit 0) or confirmedDTC (bit 3). Pending-only codes stay off the sheet. */
export const DTC_ATTENTION_STATUS = 0x09;

const CATEGORY: Record<string, number> = { P: 0, C: 1, B: 2, U: 3 };

export function encodeSaeJ2012(code: string): number[] | null {
  const text = code.trim().toUpperCase();
  if (!SAE_CODE.test(text)) return null;
  const category = CATEGORY[text[0]];
  const second = Number.parseInt(text[1], 16);
  const third = Number.parseInt(text[2], 16);
  const fourth = Number.parseInt(text[3], 16);
  const fifth = Number.parseInt(text[4], 16);
  const byte0 = (category << 6) | ((second & 0x3) << 4) | (third & 0xf);
  const byte1 = ((fourth & 0xf) << 4) | (fifth & 0xf);
  return [byte0, byte1, 0x00];
}

export function decodeSaeJ2012(byte0: number, byte1: number): string {
  return (
    LETTERS[byte0 >> 6] +
    String((byte0 >> 4) & 0x03) +
    HEX[byte0 & 0x0f] +
    HEX[byte1 >> 4] +
    HEX[byte1 & 0x0f]
  );
}

/** Staff label for a standard five-character code. Short Triumph codes such as C14 stay unlabeled. */
export function saeJ2012System(code: string): string | null {
  const text = code.trim().toUpperCase();
  if (!encodeSaeJ2012(text)) return null;
  const value = Number.parseInt(text.slice(1), 16);
  if (text[0] === "C") return "chassis";
  if (text[0] === "B") return "body";
  if (text[0] === "U") return "network";
  if (value >= 0x0a00 && value <= 0x0aff) return "high-voltage battery";
  if (value >= 0x0b00 && value <= 0x0bff) return "hybrid drive";
  if (value >= 0x0100 && value <= 0x02ff) return "fuel and air";
  if (value >= 0x0300 && value <= 0x03ff) return "ignition system";
  if (value >= 0x0400 && value <= 0x04ff) return "emissions system";
  return null;
}

export function faultCodeLabel(code: string): string {
  const system = saeJ2012System(code);
  return system ? `${code} (${system})` : code;
}

/**
 * Mode 03 payload starts with 0x43 and then two-byte codes.
 * UDS reportDTCByStatusMask starts with 0x59 0x02, an availability mask, then
 * three-byte codes plus a status byte. A 0x7F negative response contributes nothing.
 */
export function codesFromObdPayload(payload: number[]): string[] {
  const codes: string[] = [];
  const push = (byte0: number, byte1: number) => {
    if (codes.length >= 20) return;
    if (byte0 === 0 && byte1 === 0) return;
    const code = decodeSaeJ2012(byte0, byte1);
    if (!codes.includes(code)) codes.push(code);
  };

  if (payload.length < 1 || payload[0] === 0x7f) return codes;

  if (payload[0] === 0x43) {
    for (let i = 1; i + 1 < payload.length && codes.length < 20; i += 2) {
      push(payload[i], payload[i + 1]);
    }
    return codes;
  }

  if (payload[0] === 0x59 && payload.length >= 3 && payload[1] === 0x02) {
    for (let i = 3; i + 3 < payload.length && codes.length < 20; i += 4) {
      if (payload[i] === 0 && payload[i + 1] === 0 && payload[i + 2] === 0) continue;
      if ((payload[i + 3] & DTC_ATTENTION_STATUS) === 0) continue;
      push(payload[i], payload[i + 1]);
    }
  }

  return codes;
}
