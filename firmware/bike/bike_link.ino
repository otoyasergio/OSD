// Triumph bike box. Seeed XIAO nRF52840. Pin names match docs/hardware/bike-link-wiring.md.
// Change BOX_ID to the sticker on this box. Odometer stays empty until a bike in the bay
// answers a confirmed request. Do not invent a PID.

#include <SPI.h>
#include <bluefruit.h>
#include <stdio.h>
#include <string.h>

#include "packet.h"

#if defined(__has_include)
#if __has_include("radio.h")
#include "radio.h"
#endif
#endif

static const char BOX_ID[] = "TM-BL-0007";

static const int PIN_VOLT = D0;
static const int PIN_DIVIDER = D1;
static const int PIN_KEY = D2;
static const int PIN_CAN_EN = D3;
static const int PIN_CAN_CS = D4;
static const int PIN_RADIO_TX = D6;
static const int PIN_RADIO_RX = D7;

static const uint16_t OBD_REQUEST_ID = 0x7DF;
static const uint16_t OBD_FLOW_ID = 0x7E0;
static const uint16_t OBD_RESPONSE_ID = 0x7E8;
static const float BENCH_VOLT_SCALE = (3.3f * (112.0f / 12.0f)) / 1023.0f;
static const uint32_t KEY_HOLD_MS = 3000;
static const uint32_t ECU_WAIT_MS = 4000;
static const uint32_t REST_WAIT_MS = 20UL * 60UL * 1000UL;
static const uint32_t DAY_MS = 24UL * 60UL * 60UL * 1000UL;
static const uint32_t WEEK_MS = 7UL * DAY_MS;
static const uint32_t ADVERTISE_MS = 3UL * 60UL * 1000UL;
static const uint32_t RADIO_GAP_MS = 30000;

static const uint8_t MCP_WRITE = 0x02;
static const uint8_t MCP_READ = 0x03;
static const uint8_t MCP_BITMOD = 0x05;
static const uint8_t MCP_RESET = 0xC0;
static const uint8_t MCP_CANCTRL = 0x0F;
static const uint8_t MCP_CANSTAT = 0x0E;
static const uint8_t MCP_CNF3 = 0x28;
static const uint8_t MCP_CNF2 = 0x29;
static const uint8_t MCP_CNF1 = 0x2A;
static const uint8_t MCP_CANINTF = 0x2C;
static const uint8_t MCP_TXB0CTRL = 0x30;
static const uint8_t MCP_TXB0SIDH = 0x31;
static const uint8_t MCP_RXB0CTRL = 0x60;

struct ClockAnchor {
  bool set;
  long long unixSeconds;
  uint32_t millisAtSet;
};

struct StoredRow {
  bool used;
  char odometer[8];
  char batteryVolts[8];
  char faultCodes[160];
  char recordedAt[24];
  bool clockSet;
  bool handedOff;
  uint8_t radioTries;
  uint8_t radioBudget;
  bool dailyRadioUsed;
  uint32_t nextRadioAt;
  uint32_t advertiseUntil;
};

static ClockAnchor clock = {false, 0, 0};
static StoredRow row = {};
static long lastOdometer = -1;
static int lastVoltageTenths = -1;
static uint32_t lastVoltageAt = 0;
static uint32_t parkedSince = 0;
static uint32_t keyLowSince = 0;
static uint32_t restAt = 0;
static bool riding = false;
static bool rideCaptured = false;

static BLEService bikeService("8a1f0001-7b2c-4d5e-9f01-b1c2d3e4f501");
static BLECharacteristic readingChar("8a1f0002-7b2c-4d5e-9f01-b1c2d3e4f501");
static BLECharacteristic clockChar("8a1f0003-7b2c-4d5e-9f01-b1c2d3e4f501");

static void radioBringUp();
static void radioOffer(const char* json);
static void radioPoll(const char* recordedAt);

static void canPower(bool on) {
  digitalWrite(PIN_CAN_EN, on ? LOW : HIGH);
}

static void copyText(char* dest, size_t cap, const char* value) {
  if (cap == 0) return;
  if (!value) value = "";
  snprintf(dest, cap, "%s", value);
}

static long long daysFromCivil(long y, unsigned m, unsigned d) {
  y -= m <= 2;
  const long era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097LL + (long long)doe - 719468LL;
}

static void civilFromDays(long long z, int* year, unsigned* month, unsigned* day) {
  z += 719468LL;
  const long long era = (z >= 0 ? z : z - 146096) / 146097;
  const unsigned doe = (unsigned)(z - era * 146097);
  const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  const long y = (long)yoe + era * 400;
  const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  const unsigned mp = (5 * doy + 2) / 153;
  const unsigned d = doy - (153 * mp + 2) / 5 + 1;
  const unsigned m = mp < 10 ? mp + 3 : mp - 9;
  *year = (int)(y + (m <= 2));
  *month = m;
  *day = d;
}

static void formatUnix(long long unixSeconds, char* out, size_t cap) {
  long long days = unixSeconds / 86400LL;
  long long rem = unixSeconds % 86400LL;
  if (rem < 0) {
    rem += 86400LL;
    days -= 1;
  }
  int year = 1970;
  unsigned month = 1;
  unsigned day = 1;
  civilFromDays(days, &year, &month, &day);
  unsigned hour = (unsigned)(rem / 3600LL);
  unsigned minute = (unsigned)((rem % 3600LL) / 60LL);
  unsigned second = (unsigned)(rem % 60LL);
  snprintf(out, cap, "%04d-%02u-%02uT%02u:%02u:%02uZ", year, month, day, hour, minute, second);
}

static bool formatNow(char* out, size_t cap) {
  if (!clock.set) {
    if (cap > 0) out[0] = '\0';
    return false;
  }
  long long elapsed = (long long)(millis() - clock.millisAtSet) / 1000LL;
  formatUnix(clock.unixSeconds + elapsed, out, cap);
  return true;
}

static void remember(const char* odometer, const char* volts, const char* faults, uint8_t budget) {
  bool hasOdo = odometer && odometer[0];
  bool hasVolts = volts && volts[0];
  bool hasFaults = faults && faults[0];
  if (!hasOdo && !hasVolts && !hasFaults) return;
  row.used = true;
  copyText(row.odometer, sizeof row.odometer, odometer);
  copyText(row.batteryVolts, sizeof row.batteryVolts, volts);
  copyText(row.faultCodes, sizeof row.faultCodes, faults);
  row.handedOff = false;
  row.radioTries = 0;
  row.radioBudget = budget;
  row.dailyRadioUsed = budget < 4;
  row.nextRadioAt = 0;
  row.clockSet = formatNow(row.recordedAt, sizeof row.recordedAt);
  row.advertiseUntil = row.clockSet ? millis() + ADVERTISE_MS : 0;
}

static bool keepOdometer(const String& raw, char* out, size_t cap) {
  out[0] = '\0';
  if (raw.length() == 0 || raw == "0") return false;
  for (unsigned i = 0; i < raw.length(); i++) {
    if (raw.charAt(i) < '0' || raw.charAt(i) > '9') return false;
  }
  long value = raw.toInt();
  if (value <= 0) return false;
  if (lastOdometer >= 0 && value < lastOdometer) return false;
  snprintf(out, cap, "%ld", value);
  lastOdometer = value;
  return true;
}

// Returns empty until a Triumph in the shop answers a confirmed request.
static String readOdometer() {
  return "";
}

static void mcpSelect(bool active) {
  digitalWrite(PIN_CAN_CS, active ? LOW : HIGH);
}

static void mcpWriteReg(uint8_t reg, uint8_t value) {
  mcpSelect(true);
  SPI.transfer(MCP_WRITE);
  SPI.transfer(reg);
  SPI.transfer(value);
  mcpSelect(false);
}

static uint8_t mcpReadReg(uint8_t reg) {
  mcpSelect(true);
  SPI.transfer(MCP_READ);
  SPI.transfer(reg);
  uint8_t value = SPI.transfer(0x00);
  mcpSelect(false);
  return value;
}

static void mcpModify(uint8_t reg, uint8_t mask, uint8_t value) {
  mcpSelect(true);
  SPI.transfer(MCP_BITMOD);
  SPI.transfer(reg);
  SPI.transfer(mask);
  SPI.transfer(value);
  mcpSelect(false);
}

static void mcpSetBitrate(long bitrate) {
  uint8_t c1 = 0x00;
  uint8_t c2 = 0xF0;
  uint8_t c3 = 0x86;
  if (bitrate == 250000) {
    c1 = 0x41;
    c2 = 0xF1;
    c3 = 0x85;
  }
  mcpWriteReg(MCP_CNF1, c1);
  mcpWriteReg(MCP_CNF2, c2);
  mcpWriteReg(MCP_CNF3, c3);
}

static bool mcpStart(long bitrate) {
  mcpSelect(true);
  SPI.transfer(MCP_RESET);
  mcpSelect(false);
  delay(2);
  mcpModify(MCP_CANCTRL, 0xE0, 0x80);
  mcpSetBitrate(bitrate);
  mcpWriteReg(MCP_RXB0CTRL, 0x60);
  mcpModify(MCP_CANCTRL, 0xE0, 0x00);
  delay(1);
  return (mcpReadReg(MCP_CANSTAT) & 0xE0) == 0x00;
}

static void mcpSend(uint16_t id, const uint8_t* data) {
  mcpWriteReg(MCP_TXB0CTRL, 0x00);
  mcpWriteReg(MCP_TXB0SIDH, (uint8_t)(id >> 3));
  mcpWriteReg(MCP_TXB0SIDH + 1, (uint8_t)((id & 0x07) << 5));
  mcpWriteReg(MCP_TXB0SIDH + 4, 8);
  for (uint8_t i = 0; i < 8; i++) mcpWriteReg(MCP_TXB0SIDH + 5 + i, data[i]);
  mcpModify(MCP_TXB0CTRL, 0x08, 0x08);
}

static bool mcpReadFrame(uint16_t* id, uint8_t* data) {
  if ((mcpReadReg(MCP_CANINTF) & 0x01) == 0) return false;
  uint8_t sidh = mcpReadReg(0x61);
  uint8_t sidl = mcpReadReg(0x62);
  *id = ((uint16_t)sidh << 3) | (sidl >> 5);
  for (uint8_t i = 0; i < 8; i++) data[i] = mcpReadReg(0x66 + i);
  mcpModify(MCP_CANINTF, 0x01, 0x00);
  return true;
}

static bool acceptCode(const char* code) {
  size_t length = strlen(code);
  if (length == 0 || length > 12) return false;
  for (size_t i = 0; i < length; i++) {
    char c = code[i];
    bool ok = (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
    if (!ok) return false;
  }
  return true;
}

static bool alreadyListed(const char* faults, const char* code) {
  size_t length = strlen(code);
  const char* found = faults;
  while ((found = strstr(found, code)) != NULL) {
    bool start = found == faults || found[-1] == ' ';
    bool end = found[length] == '\0' || found[length] == ' ';
    if (start && end) return true;
    found += length;
  }
  return false;
}

static void appendCode(char* faults, size_t cap, const char* code, int* count) {
  if (*count >= 20 || !acceptCode(code) || alreadyListed(faults, code)) return;
  size_t used = strlen(faults);
  size_t need = strlen(code) + (used > 0 ? 1 : 0);
  if (used + need + 1 > cap) return;
  if (used > 0) faults[used++] = ' ';
  memcpy(faults + used, code, strlen(code) + 1);
  *count += 1;
}

static void formatDtc(uint8_t a, uint8_t b, char* out) {
  static const char* digits = "0123456789ABCDEF";
  static const char letters[] = {'P', 'C', 'B', 'U'};
  out[0] = letters[a >> 6];
  out[1] = (char)('0' + ((a >> 4) & 0x03));
  out[2] = digits[a & 0x0F];
  out[3] = digits[b >> 4];
  out[4] = digits[b & 0x0F];
  out[5] = '\0';
}

static void consumePayload(const uint8_t* payload, int length, char* faults, size_t cap, int* count) {
  if (length < 1 || payload[0] == 0x7F) return;
  if (payload[0] == 0x43) {
    for (int i = 1; i + 1 < length && *count < 20; i += 2) {
      if (payload[i] == 0 && payload[i + 1] == 0) continue;
      char code[6];
      formatDtc(payload[i], payload[i + 1], code);
      appendCode(faults, cap, code, count);
    }
    return;
  }
  // reportDTCByStatusMask: 59 02, availability mask, then 3-byte DTC + status.
  // Keep a code when testFailed or confirmedDTC is set (status bit 0 or bit 3).
  if (payload[0] != 0x59 || length < 3 || payload[1] != 0x02) return;
  for (int i = 3; i + 3 < length && *count < 20; i += 4) {
    if (payload[i] == 0 && payload[i + 1] == 0 && payload[i + 2] == 0) continue;
    if ((payload[i + 3] & 0x09) == 0) continue;
    char code[6];
    formatDtc(payload[i], payload[i + 1], code);
    appendCode(faults, cap, code, count);
  }
}

// 0 = nobody answered. 1 = a negative response, so this bitrate is live. 2 = a positive payload.
static int ask(long bitrate, const uint8_t* request, char* faults, size_t faultsCap, int* count) {
  if (!mcpStart(bitrate)) return 0;
  mcpSend(OBD_REQUEST_ID, request);

  uint8_t payload[64];
  int payloadLen = 0;
  int expected = 0;
  bool answered = false;
  uint32_t start = millis();
  while ((uint32_t)(millis() - start) < 400) {
    uint16_t id = 0;
    uint8_t frame[8];
    if (!mcpReadFrame(&id, frame) || id != OBD_RESPONSE_ID) continue;
    uint8_t pci = frame[0];
    if ((pci & 0xF0) == 0x00) {
      payloadLen = pci & 0x0F;
      if (payloadLen > 7) payloadLen = 7;
      memcpy(payload, frame + 1, payloadLen);
      answered = true;
      break;
    }
    if ((pci & 0xF0) == 0x10) {
      expected = ((pci & 0x0F) << 8) | frame[1];
      if (expected > (int)sizeof payload) expected = (int)sizeof payload;
      int first = expected > 6 ? 6 : expected;
      memcpy(payload, frame + 2, first);
      payloadLen = first;
      const uint8_t flow[8] = {0x30, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
      mcpSend(OBD_FLOW_ID, flow);
      answered = true;
    } else if ((pci & 0xF0) == 0x20 && payloadLen < expected) {
      int chunk = expected - payloadLen;
      if (chunk > 7) chunk = 7;
      memcpy(payload + payloadLen, frame + 1, chunk);
      payloadLen += chunk;
      if (payloadLen >= expected) break;
    }
  }
  if (!answered || payloadLen < 1) return 0;
  if (payload[0] == 0x7F) return 1;
  consumePayload(payload, payloadLen, faults, faultsCap, count);
  return 2;
}

static void readBus(char* faults, size_t faultsCap) {
  faults[0] = '\0';
  int count = 0;
  // Service 03 reads stored emission codes. Service 19 subfunction 02 reads
  // DTC by status mask. Both are reads. do not clear codes.
  const uint8_t mode03[8] = {0x01, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
  const uint8_t readByMask[8] = {0x03, 0x19, 0x02, 0xFF, 0x00, 0x00, 0x00, 0x00};
  // Try 500 kbit/s, then 250. Request id 7DF.
  int heard = ask(500000, mode03, faults, faultsCap, &count);
  long rate = 500000;
  if (heard == 0) {
    heard = ask(250000, mode03, faults, faultsCap, &count);
    rate = 250000;
  }
  if (heard == 0) {
    if (ask(500000, readByMask, faults, faultsCap, &count) == 0) {
      ask(250000, readByMask, faults, faultsCap, &count);
    }
    return;
  }
  ask(rate, readByMask, faults, faultsCap, &count);
}

static bool sampleVolts(char* out, size_t cap) {
  digitalWrite(PIN_DIVIDER, HIGH);
  delay(5);
  int adc = analogRead(PIN_VOLT);
  digitalWrite(PIN_DIVIDER, LOW);
  float volts = adc * BENCH_VOLT_SCALE;
  if (volts >= 13.4f || volts < 8.0f || volts > 16.0f) {
    out[0] = '\0';
    return false;
  }
  snprintf(out, cap, "%.1f", volts);
  return out[0] != '\0';
}

static int voltTenths(const char* volts) {
  int whole = 0;
  int frac = 0;
  if (sscanf(volts, "%d.%d", &whole, &frac) < 1) return -1;
  return whole * 10 + frac;
}

static void captureCan() {
  canPower(true);
  delay(50);
  SPI.begin();
  char faults[160];
  readBus(faults, sizeof faults);
  char odometer[8];
  keepOdometer(readOdometer(), odometer, sizeof odometer);
  if (odometer[0] || faults[0]) remember(odometer, "", faults, 4);
}

static void beginRide() {
  delay(ECU_WAIT_MS);
  captureCan();
  rideCaptured = true;
}

static void endRide() {
  if (rideCaptured) captureCan();
  canPower(false);
  restAt = millis() + REST_WAIT_MS;
  riding = false;
  rideCaptured = false;
}

static void storeRestedVoltage() {
  char volts[8];
  if (!sampleVolts(volts, sizeof volts)) return;
  lastVoltageTenths = voltTenths(volts);
  lastVoltageAt = millis();
  if (row.used && !row.handedOff) {
    copyText(row.batteryVolts, sizeof row.batteryVolts, volts);
    return;
  }
  remember("", volts, "", 4);
}

static void storeDailyVoltage() {
  char volts[8];
  if (!sampleVolts(volts, sizeof volts)) return;
  int tenths = voltTenths(volts);
  if (tenths < 0) return;
  int delta = tenths - lastVoltageTenths;
  if (delta < 0) delta = -delta;
  bool week = lastVoltageAt == 0 || (uint32_t)(millis() - lastVoltageAt) >= WEEK_MS;
  bool moved = lastVoltageTenths < 0 || delta >= 1;
  if (!week && !moved) return;
  lastVoltageTenths = tenths;
  lastVoltageAt = millis();
  canPower(false);
  if (row.used && !row.handedOff) {
    copyText(row.batteryVolts, sizeof row.batteryVolts, volts);
    if (row.radioTries >= row.radioBudget && !row.dailyRadioUsed) {
      row.radioBudget = row.radioTries + 1;
      row.dailyRadioUsed = true;
      row.nextRadioAt = 0;
    }
    if (row.clockSet) row.advertiseUntil = millis() + ADVERTISE_MS;
    return;
  }
  remember("", volts, "", 1);
}

static void publishBle() {
  if (!row.used || !row.clockSet) {
    Bluefruit.Advertising.stop();
    return;
  }
  if (row.advertiseUntil == 0 || (int32_t)(millis() - row.advertiseUntil) >= 0) {
    Bluefruit.Advertising.stop();
    row.advertiseUntil = 0;
    return;
  }
  BikePacketView view = {BOX_ID, row.odometer, row.batteryVolts, row.faultCodes, row.recordedAt, true};
  char json[241];
  if (writeBikePacket(&view, json, sizeof json) == 0) return;
  readingChar.write((const uint8_t*)json, (uint16_t)strlen(json));
  if (!Bluefruit.Advertising.isRunning()) {
    Bluefruit.Advertising.clearData();
    Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
    Bluefruit.Advertising.addName();
    Bluefruit.Advertising.addService(bikeService);
    Bluefruit.Advertising.restartOnDisconnect(false);
    Bluefruit.Advertising.start(180);
  }
}

static void offerRadio() {
  if (!row.used || row.handedOff || !row.clockSet) return;
  if (row.radioTries >= row.radioBudget) return;
  if (row.nextRadioAt != 0 && (int32_t)(millis() - row.nextRadioAt) < 0) return;
  BikePacketView view = {BOX_ID, row.odometer, row.batteryVolts, row.faultCodes, row.recordedAt, row.clockSet};
  char json[241];
  if (!readyForRadio(&view) || writeBikePacket(&view, json, sizeof json) == 0) return;
  row.radioTries++;
  row.nextRadioAt = millis() + RADIO_GAP_MS;
  radioOffer(json);
}

static void onClockWritten(uint16_t, BLECharacteristic*, uint8_t* data, uint16_t len) {
  if (len == 0 || len > 31) return;
  char text[32];
  memcpy(text, data, len);
  text[len] = '\0';
  int year = 0;
  int month = 0;
  int day = 0;
  int hour = 0;
  int minute = 0;
  int second = 0;
  if (sscanf(text, "%d-%d-%dT%d:%d:%dZ", &year, &month, &day, &hour, &minute, &second) != 6) return;
  clock.unixSeconds = daysFromCivil(year, (unsigned)month, (unsigned)day) * 86400LL +
                      hour * 3600LL + minute * 60LL + second;
  clock.millisAtSet = millis();
  clock.set = true;
  if (row.used && !row.clockSet) {
    row.clockSet = formatNow(row.recordedAt, sizeof row.recordedAt);
    row.advertiseUntil = millis() + ADVERTISE_MS;
    row.radioTries = 0;
    row.nextRadioAt = 0;
  }
}

static void startBle() {
  Bluefruit.autoConnLed(false);
  Bluefruit.begin();
  Bluefruit.setTxPower(-8);
  Bluefruit.setName(BOX_ID);
  bikeService.begin();
  readingChar.setProperties(CHR_PROPS_READ | CHR_PROPS_NOTIFY);
  readingChar.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  readingChar.setMaxLen(244);
  readingChar.begin();
  clockChar.setProperties(CHR_PROPS_WRITE);
  clockChar.setPermission(SECMODE_NO_ACCESS, SECMODE_OPEN);
  clockChar.setMaxLen(32);
  clockChar.setWriteCallback(onClockWritten);
  clockChar.begin();
  Bluefruit.Advertising.stop();
}

static bool keyHeldOn() {
  if (digitalRead(PIN_KEY) == LOW) {
    if (keyLowSince == 0) keyLowSince = millis();
    return (uint32_t)(millis() - keyLowSince) >= KEY_HOLD_MS;
  }
  keyLowSince = 0;
  return false;
}

static void sleepParked() {
  canPower(false);
  digitalWrite(PIN_DIVIDER, LOW);
  digitalWrite(PIN_CAN_CS, HIGH);
#if !defined(BIKE_LINK_RADIO)
  pinMode(PIN_RADIO_TX, INPUT);
  pinMode(PIN_RADIO_RX, INPUT);
#endif
  // CAN and the divider are off. The fuse measurement is the sleep pass mark.
  delay(1000);
}

void setup() {
  pinMode(PIN_CAN_EN, OUTPUT);
  canPower(false);
  pinMode(PIN_DIVIDER, OUTPUT);
  digitalWrite(PIN_DIVIDER, LOW);
  pinMode(PIN_KEY, INPUT_PULLUP);
  pinMode(PIN_VOLT, INPUT);
  pinMode(PIN_CAN_CS, OUTPUT);
  digitalWrite(PIN_CAN_CS, HIGH);
  pinMode(PIN_RADIO_TX, INPUT);
  pinMode(PIN_RADIO_RX, INPUT);
  parkedSince = millis();
  startBle();
  radioBringUp();
}

void loop() {
  bool keyOn = keyHeldOn();
  if (keyOn && !riding) {
    riding = true;
    rideCaptured = false;
    beginRide();
  } else if (!keyOn && riding) {
    endRide();
    parkedSince = millis();
  }

  if (!riding && restAt != 0 && (int32_t)(millis() - restAt) >= 0 && digitalRead(PIN_KEY) == HIGH) {
    storeRestedVoltage();
    restAt = 0;
    canPower(false);
  }

  if (!riding && restAt == 0 && (uint32_t)(millis() - parkedSince) >= DAY_MS) {
    storeDailyVoltage();
    parkedSince = millis();
  }

  radioPoll(row.recordedAt);
  publishBle();
  offerRadio();
  if (riding) return;
  if (Bluefruit.Advertising.isRunning()) delay(200);
  else sleepParked();
}

#if defined(BIKE_LINK_RADIO) && (BIKE_LINK_RADIO)
static char radioHeard[160];
static size_t radioHeardLen = 0;

static void radioBringUp() {
  Serial1.begin(115200);
  delay(100);
  Serial1.println("AT+CRFOP=0");
  delay(100);
  Serial1.println("AT+BAND=915000000");
  delay(100);
  Serial1.println("AT+MODE=1");
}

static void radioOffer(const char* json) {
  if (!json || json[0] == '\0' || strlen(json) > 240) return;
  char command[280];
  snprintf(command, sizeof command, "AT+SEND=0,%u,%s", (unsigned)strlen(json), json);
  Serial1.println(command);
  delay(200);
  Serial1.println("AT+MODE=1");
}

static void radioPoll(const char* recordedAt) {
  if (!recordedAt || recordedAt[0] == '\0') return;
  while (Serial1.available() > 0) {
    if (radioHeardLen + 1 >= sizeof radioHeard) {
      memmove(radioHeard, radioHeard + 40, radioHeardLen - 40);
      radioHeardLen -= 40;
    }
    radioHeard[radioHeardLen++] = (char)Serial1.read();
    radioHeard[radioHeardLen] = '\0';
    if (strstr(radioHeard, recordedAt)) row.handedOff = true;
  }
}
#else
static void radioBringUp() {
  pinMode(PIN_RADIO_TX, INPUT);
  pinMode(PIN_RADIO_RX, INPUT);
}

static void radioOffer(const char*) {}

static void radioPoll(const char*) {}
#endif
