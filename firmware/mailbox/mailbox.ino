// Window box. One ESP32-S3 for every place. The bike does not join Wi-Fi.
// Copy secrets.example.h to secrets.h. Do not commit secrets.h.

#include <HTTPClient.h>
#include <WiFi.h>

#include "secrets.h"

// Place is compile-time. Keep one pair:
//   shop_bay  99 River Street
//   home      empty, or a short label
//   partner   place name, 80 characters or fewer
static const char SOURCE[] = "shop_bay";
static const char PLACE_NAME[] = "99 River Street";

// Devkit TX goes to the RYLR998 RX. Devkit RX comes from the RYLR998 TX. 3.3 V only.
static const int RADIO_TX_PIN = 17;
static const int RADIO_RX_PIN = 18;

static String inbound;

static void radioCommand(const char* command) {
  Serial1.println(command);
  delay(100);
}

static String jsonStringField(const String& json, const char* key) {
  String pattern = String("\"") + key + "\":\"";
  int start = json.indexOf(pattern);
  if (start < 0) return "";
  start += pattern.length();
  int end = json.indexOf('"', start);
  if (end < 0) return "";
  return json.substring(start, end);
}

static bool clockIsSet(const String& json) {
  return json.indexOf("\"clockSet\":true") >= 0 || json.indexOf("\"clockSet\": true") >= 0;
}

static String mailboxBody(const String& bikeJson) {
  String body = "{";
  body += "\"boxId\":\"" + jsonStringField(bikeJson, "boxId") + "\",";
  body += "\"source\":\"" + String(SOURCE) + "\",";
  body += "\"placeName\":\"" + String(PLACE_NAME) + "\",";
  body += "\"odometer\":\"" + jsonStringField(bikeJson, "odometer") + "\",";
  body += "\"batteryVolts\":\"" + jsonStringField(bikeJson, "batteryVolts") + "\",";
  body += "\"faultCodes\":\"" + jsonStringField(bikeJson, "faultCodes") + "\",";
  body += "\"recordedAt\":\"" + jsonStringField(bikeJson, "recordedAt") + "\"";
  body += "}";
  return body;
}

static String readingsUrl() {
  String url = BIKE_LINK_URL;
  if (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/api/bike-link/readings";
  return url;
}

static void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && (uint32_t)(millis() - start) < 8000) {
    delay(100);
  }
}

static void replyRecordedAt(const String& recordedAt) {
  String ack = String("{\"recordedAt\":\"") + recordedAt + "\"}";
  String command = String("AT+SEND=0,") + String(ack.length()) + "," + ack;
  Serial1.println(command);
}

static void postReading(const String& body) {
  // Staff can type this into the motorcycle page if the post does not land.
  Serial.println(body);
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("bike-link Wi-Fi down");
    return;
  }

  HTTPClient http;
  http.begin(readingsUrl());
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + BIKE_LINK_INGEST_SECRET);
  int status = http.POST(body);
  http.end();
  Serial.printf("bike-link HTTP %d\n", status);

  if (status == 200 || status == 201) {
    replyRecordedAt(jsonStringField(body, "recordedAt"));
    return;
  }
  if (status == 401) return;
}

static void handleBike(const String& bikeJson) {
  if (jsonStringField(bikeJson, "boxId").length() == 0) return;
  if (!clockIsSet(bikeJson)) return;
  postReading(mailboxBody(bikeJson));
}

static void pollRadio() {
  while (Serial1.available() > 0) {
    inbound += (char)Serial1.read();
    if (inbound.length() > 512) inbound.remove(0, inbound.length() - 256);
    int start = inbound.indexOf('{');
    int end = start >= 0 ? inbound.indexOf('}', start) : -1;
    if (start >= 0 && end > start) {
      String json = inbound.substring(start, end + 1);
      inbound = inbound.substring(end + 1);
      handleBike(json);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial1.begin(115200, SERIAL_8N1, RADIO_RX_PIN, RADIO_TX_PIN);
  delay(200);
  radioCommand("AT+CRFOP=0");
  radioCommand("AT+BAND=915000000");
  connectWifi();
}

void loop() {
  pollRadio();
  delay(20);
}
