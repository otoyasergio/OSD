/** Same keys and empty-string rule as `firmware/bike/packet.cpp`. */

export const BIKE_RADIO_LIMIT = 240;

export type BikePacket = {
  boxId: string;
  odometer: string;
  batteryVolts: string;
  faultCodes: string;
  recordedAt: string;
  clockSet: boolean;
};

export type BikePacketRow = {
  boxId: string;
  odometer?: string | null;
  batteryVolts?: string | null;
  faultCodes?: string | null;
  recordedAt?: string | null;
  clockSet: boolean;
};

function unread(value: string | null | undefined): string {
  return value ?? "";
}

export function bikePacket(row: BikePacketRow): BikePacket {
  return {
    boxId: row.boxId,
    odometer: unread(row.odometer),
    batteryVolts: unread(row.batteryVolts),
    faultCodes: unread(row.faultCodes),
    recordedAt: unread(row.recordedAt),
    clockSet: row.clockSet,
  };
}

export function readyForRadio(packet: BikePacket): boolean {
  return packet.clockSet && JSON.stringify(packet).length <= BIKE_RADIO_LIMIT;
}
