#include "packet.h"

#include <stdio.h>

static const char* textOrEmpty(const char* value) {
  return value ? value : "";
}

size_t writeBikePacket(const BikePacketView* row, char* out, size_t cap) {
  if (!row || !out || cap == 0) return 0;
  int wrote = snprintf(
      out,
      cap,
      "{\"boxId\":\"%s\",\"odometer\":\"%s\",\"batteryVolts\":\"%s\",\"faultCodes\":\"%s\",\"recordedAt\":\"%s\",\"clockSet\":%s}",
      textOrEmpty(row->boxId),
      textOrEmpty(row->odometer),
      textOrEmpty(row->batteryVolts),
      textOrEmpty(row->faultCodes),
      textOrEmpty(row->recordedAt),
      row->clockSet ? "true" : "false");
  if (wrote < 0 || (size_t)wrote >= cap || wrote > 240) {
    out[0] = '\0';
    return 0;
  }
  return (size_t)wrote;
}

bool readyForRadio(const BikePacketView* row) {
  char buf[241];
  if (!row || !row->clockSet) return false;
  return writeBikePacket(row, buf, sizeof buf) > 0;
}
