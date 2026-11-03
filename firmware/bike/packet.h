#pragma once

#include <stdbool.h>
#include <stddef.h>

// Bike JSON. Empty unread fields are "". clockSet false stays off the radio.
struct BikePacketView {
  const char* boxId;
  const char* odometer;
  const char* batteryVolts;
  const char* faultCodes;
  const char* recordedAt;
  bool clockSet;
};

size_t writeBikePacket(const BikePacketView* row, char* out, size_t cap);
bool readyForRadio(const BikePacketView* row);
