/* =========================================================================
 * MUDRA System - Module 1: ESP32 Hardware Glove Node Firmware
 * File: module1/glove_node.ino
 * 
 * Hardware Platform: ESP32 (e.g., NodeMCU ESP32 / ESP-WROOM-32)
 *
 * Description:
 * Reconfigured Module 1 firmware for the actual MUDRA prototype hardware:
 * - 5 homemade binary digital contact switches (Thumb, Index, Middle, Ring, Little)
 *   configured as INPUT_PULLUP (LOW = active/bent, HIGH = straight/inactive)
 * - 1 tactile mode toggle button on GPIO 19 with software debouncing (0 <-> 1)
 * - 1 HC-SR04 ultrasonic distance sensor (TRIG GPIO 5, ECHO GPIO 18 via voltage divider)
 * - 6-bit gesture representation (Bit 5: Mode, Bit 4: Thumb, Bit 3: Index,
 *   Bit 2: Middle, Bit 1: Ring, Bit 0: Little)
 * - Wi-Fi connectivity and UDP JSON datagram transmission to host workstation (port 5005)
 * - Decoupled sensor acquisition/UDP transmission (100 ms) and human-readable
 *   Serial diagnostics (1000 ms)
 *
 * Pin Mapping:
 * - Thumb Contact Switch   : GPIO 13 (INPUT_PULLUP, active-LOW)
 * - Index Contact Switch   : GPIO 14 (INPUT_PULLUP, active-LOW)
 * - Middle Contact Switch  : GPIO 25 (INPUT_PULLUP, active-LOW)
 * - Ring Contact Switch    : GPIO 26 (INPUT_PULLUP, active-LOW)
 * - Little Contact Switch  : GPIO 27 (INPUT_PULLUP, active-LOW)
 * - Mode Toggle Button     : GPIO 19 (INPUT_PULLUP, active-LOW)
 * - HC-SR04 TRIG           : GPIO 5  (Digital Output)
 * - HC-SR04 ECHO           : GPIO 18 (Digital Input, 5V->3.3V divider)
 * ========================================================================= */

#include <WiFi.h>
#include <WiFiUdp.h>
#include <ArduinoJson.h>

// =========================================================================
// 1. NETWORK & UDP CONFIGURATION
// =========================================================================
// Replace with your local 2.4 GHz Wi-Fi credentials
const char* WIFI_SSID     = "Galaxy F23 5G 536B";
const char* WIFI_PASSWORD = "33442211";

// Host IPv4 on the same Wi-Fi network as the ESP32 (not the Windows virtual hotspot adapter).
const char* RECEIVER_IP   = "192.168.189.253";
const int   RECEIVER_PORT = 5005; // MUDRA Module 1 -> Module 2 UDP Port
const int   LOCAL_PORT    = 5006; // Local ESP32 UDP port

WiFiUDP udp;

// =========================================================================
// 2. HARDWARE PIN DEFINITIONS (Actual Hardware Prototype)
// =========================================================================
#define PIN_CONTACT_THUMB   13 // Thumb contact switch (INPUT_PULLUP)
#define PIN_CONTACT_INDEX   14 // Index contact switch (INPUT_PULLUP)
#define PIN_CONTACT_MIDDLE  25 // Middle contact switch (INPUT_PULLUP)
#define PIN_CONTACT_RING    26 // Ring contact switch (INPUT_PULLUP)
#define PIN_CONTACT_LITTLE  27 // Little contact switch (INPUT_PULLUP)

#define PIN_MODE_BUTTON     19 // Push button for mode toggle (INPUT_PULLUP)
#define PIN_TRIG             5 // HC-SR04 Ultrasonic Trigger
#define PIN_ECHO            18 // HC-SR04 Ultrasonic Echo (Via Voltage Divider to 3.3V)

// =========================================================================
// 3. DEVICE IDENTIFIER & SYSTEM STATE
// =========================================================================
const char* DEVICE_ID = "MUDRA_01";

// Operating Mode: 0 = Standard Mode, 1 = Secondary Mode
int currentMode = 0;

// Button debouncing state
int lastButtonReading = HIGH;
int buttonState = HIGH;
unsigned long lastDebounceTime = 0;
const unsigned long DEBOUNCE_DELAY_MS = 50;

// Timing intervals
const unsigned long SAMPLE_INTERVAL_MS     = 100;  // 10 Hz sensor sampling & UDP transmission
const unsigned long DIAGNOSTIC_INTERVAL_MS = 1000; // 1 Hz readable Serial diagnostics
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000; // Wi-Fi reconnect retry interval

unsigned long lastSampleTime     = 0;
unsigned long lastDiagnosticTime = 0;
unsigned long lastWiFiRetryTime  = 0;
unsigned long sequenceNumber     = 0;

// Cache of latest state for decoupled diagnostic display
bool lastThumbState   = false;
bool lastIndexState   = false;
bool lastMiddleState  = false;
bool lastRingState    = false;
bool lastLittleState  = false;
bool lastDistValid    = false;
float lastDistCm      = -1.0f;
int lastGestureCode   = 0;
bool lastSendSuccess  = false;

// =========================================================================
// 4. HELPER FUNCTIONS
// =========================================================================

/**
 * Connects to the local Wi-Fi network with timeout and status reporting.
 */
void connectToWiFi() {
  Serial.println("\n[MODULE 1] Connecting to Wi-Fi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - startAttempt) < 10000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[MODULE 1] Wi-Fi Connected!");
    Serial.print("[MODULE 1] ESP32 IP Address : ");
    Serial.println(WiFi.localIP());
    Serial.print("[MODULE 1] Target Receiver IP: ");
    Serial.print(RECEIVER_IP);
    Serial.print(":");
    Serial.println(RECEIVER_PORT);
  } else {
    Serial.println("\n[MODULE 1 WARN] Wi-Fi connection timed out. Will retry asynchronously.");
  }
}

/**
 * Checks Wi-Fi link health and reconnects asynchronously at controlled intervals.
 */
void checkWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long currentMillis = millis();
    if (currentMillis - lastWiFiRetryTime >= WIFI_RETRY_INTERVAL_MS) {
      lastWiFiRetryTime = currentMillis;
      Serial.println("[MODULE 1 WARN] Wi-Fi disconnected. Reconnecting...");
      WiFi.disconnect();
      WiFi.reconnect();
    }
  }
}

/**
 * Reads the HC-SR04 ultrasonic distance sensor with a bounded 30 ms timeout.
 * Populates isValid flag and returns distance in centimeters (2.0 to 400.0 cm).
 * When echo is missing or out of bounds, sets isValid to false and returns -1.0.
 */
float readUltrasonicDistanceCm(bool &isValid) {
  // Clear trigger pin
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);

  // Send 10 microsecond HIGH pulse
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  // Read echo pulse duration (30ms timeout ~ 5 meters max range)
  long duration = pulseIn(PIN_ECHO, HIGH, 30000);

  if (duration <= 0) {
    isValid = false;
    return -1.0f;
  }

  // Speed of sound in air is ~343 m/s = 0.0343 cm/microsecond.
  // Distance = (duration * 0.0343) / 2
  float distanceCm = (duration * 0.0343f) / 2.0f;

  // Validate supported physical measurement range (2 cm to 400 cm)
  if (distanceCm < 2.0f || distanceCm > 400.0f) {
    isValid = false;
    return -1.0f;
  }

  isValid = true;
  return distanceCm;
}

/**
 * Reads the mode toggle button with debouncing and toggles mode (0 <-> 1).
 * Toggle occurs once per physical press on the falling edge (HIGH -> LOW).
 */
void checkModeButton() {
  int reading = digitalRead(PIN_MODE_BUTTON);

  // If the switch changed due to noise or pressing, reset debounce timer
  if (reading != lastButtonReading) {
    lastDebounceTime = millis();
  }

  // If reading has persisted longer than debounce delay, accept as new state
  if ((millis() - lastDebounceTime) > DEBOUNCE_DELAY_MS) {
    if (reading != buttonState) {
      buttonState = reading;

      // Falling edge: button pressed down (to GND)
      if (buttonState == LOW) {
        currentMode = (currentMode == 0) ? 1 : 0;
      }
    }
  }

  lastButtonReading = reading;
}

/**
 * Computes the 6-bit gesture representation:
 * Bit 5: Mode
 * Bit 4: Thumb
 * Bit 3: Index
 * Bit 2: Middle
 * Bit 1: Ring
 * Bit 0: Little
 */
int encodeGestureCode(int mode, bool thumb, bool index, bool middle, bool ring, bool little) {
  int code = 0;
  code |= ((mode & 0x01) << 5);
  code |= ((thumb  ? 1 : 0) << 4);
  code |= ((index  ? 1 : 0) << 3);
  code |= ((middle ? 1 : 0) << 2);
  code |= ((ring   ? 1 : 0) << 1);
  code |= (little  ? 1 : 0);
  return code;
}

/**
 * Formats a 6-bit integer as a 6-character binary string (e.g. "010100").
 */
String formatSixBitBinary(int code) {
  String bin = "";
  for (int bit = 5; bit >= 0; bit--) {
    bin += ((code >> bit) & 0x01) ? '1' : '0';
  }
  return bin;
}

/**
 * Displays human-readable diagnostic output to the Serial Monitor (1 Hz).
 */
void printDiagnostics() {
  Serial.println("========== MUDRA MODULE 1 ==========");
  Serial.println();
  Serial.print("WiFi: ");
  Serial.println((WiFi.status() == WL_CONNECTED) ? "CONNECTED" : "DISCONNECTED");
  Serial.print("Mode: ");
  Serial.println(currentMode);
  Serial.println();
  Serial.println("Finger States:");
  Serial.print("Thumb: ");  Serial.println(lastThumbState  ? 1 : 0);
  Serial.print("Index: ");  Serial.println(lastIndexState  ? 1 : 0);
  Serial.print("Middle: "); Serial.println(lastMiddleState ? 1 : 0);
  Serial.print("Ring: ");   Serial.println(lastRingState   ? 1 : 0);
  Serial.print("Little: "); Serial.println(lastLittleState ? 1 : 0);
  Serial.println();
  Serial.println("Ultrasonic:");
  Serial.print("Valid: ");
  Serial.println(lastDistValid ? "YES" : "NO");
  Serial.print("Distance: ");
  if (lastDistValid) {
    Serial.print(lastDistCm, 1);
    Serial.println(" cm");
  } else {
    Serial.println("N/A");
  }
  Serial.println();
  Serial.println("Gesture:");
  Serial.print("Binary: ");
  Serial.println(formatSixBitBinary(lastGestureCode));
  Serial.print("Decimal: ");
  Serial.println(lastGestureCode);
  Serial.println();
  Serial.println("UDP:");
  Serial.print("Destination: ");
  Serial.print(RECEIVER_IP);
  Serial.print(":");
  Serial.println(RECEIVER_PORT);
  Serial.print("Sequence: ");
  Serial.println(sequenceNumber);
  Serial.print("Status: ");
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("NOT_CONNECTED");
  } else if (lastSendSuccess) {
    Serial.println("SENT");
  } else {
    Serial.println("SEND_FAILED");
  }
  Serial.println();
  Serial.println("====================================");
}

// =========================================================================
// 5. SETUP
// =========================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("==================================================");
  Serial.println("      MUDRA Module 1 - ESP32 Sensor Glove Node    ");
  Serial.println("==================================================");

  // Configure 5 digital contact sensors as INPUT_PULLUP
  pinMode(PIN_CONTACT_THUMB,  INPUT_PULLUP);
  pinMode(PIN_CONTACT_INDEX,  INPUT_PULLUP);
  pinMode(PIN_CONTACT_MIDDLE, INPUT_PULLUP);
  pinMode(PIN_CONTACT_RING,   INPUT_PULLUP);
  pinMode(PIN_CONTACT_LITTLE, INPUT_PULLUP);

  // Configure Mode Toggle Button as INPUT_PULLUP
  pinMode(PIN_MODE_BUTTON, INPUT_PULLUP);

  // Configure HC-SR04 Ultrasonic pins
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  digitalWrite(PIN_TRIG, LOW);

  // Connect to Wi-Fi and initialize UDP socket
  connectToWiFi();
  udp.begin(LOCAL_PORT);

  Serial.println("[MODULE 1] Initialization complete. Starting sensor acquisition loop.\n");
}

// =========================================================================
// 6. MAIN LOOP
// =========================================================================
void loop() {
  // Check mode button debouncing on every fast loop iteration
  checkModeButton();

  unsigned long currentMillis = millis();

  // -----------------------------------------------------------------------
  // Task A: Sensor Sampling & UDP Transmission (100 ms interval / 10 Hz)
  // -----------------------------------------------------------------------
  if (currentMillis - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    lastSampleTime = currentMillis;

    // Check Wi-Fi link health (controlled non-blocking retry)
    checkWiFiConnection();

    // 1. Read 5 binary contact switches (LOW = bent/active, HIGH = straight/inactive)
    bool thumbBent  = (digitalRead(PIN_CONTACT_THUMB)  == LOW);
    bool indexBent  = (digitalRead(PIN_CONTACT_INDEX)  == LOW);
    bool middleBent = (digitalRead(PIN_CONTACT_MIDDLE) == LOW);
    bool ringBent   = (digitalRead(PIN_CONTACT_RING)   == LOW);
    bool littleBent = (digitalRead(PIN_CONTACT_LITTLE) == LOW);

    // 2. Read HC-SR04 ultrasonic distance
    bool distanceValid = false;
    float distanceCm = readUltrasonicDistanceCm(distanceValid);

    // 3. Compute 6-bit gesture code
    int gestureCode = encodeGestureCode(currentMode, thumbBent, indexBent, middleBent, ringBent, littleBent);

    // 4. Update sequence counter
    sequenceNumber++;

    // Cache state for diagnostic display
    lastThumbState  = thumbBent;
    lastIndexState  = indexBent;
    lastMiddleState = middleBent;
    lastRingState   = ringBent;
    lastLittleState = littleBent;
    lastDistValid   = distanceValid;
    lastDistCm      = distanceCm;
    lastGestureCode = gestureCode;

    // 5. Build JSON Document (compatible with ArduinoJson v6 and v7)
#if ARDUINOJSON_VERSION_MAJOR >= 7
    JsonDocument doc;
    JsonObject fingers = doc["fingers"].to<JsonObject>();
    JsonObject ultrasonic = doc["ultrasonic"].to<JsonObject>();
#else
    StaticJsonDocument<384> doc;
    JsonObject fingers = doc.createNestedObject("fingers");
    JsonObject ultrasonic = doc.createNestedObject("ultrasonic");
#endif

    doc["device"]       = DEVICE_ID;
    doc["seq"]          = sequenceNumber;
    doc["mode"]         = currentMode;
    doc["emergency_mode"] = (currentMode == 1);
    doc["timestamp_ms"] = currentMillis;

    fingers["thumb"]  = thumbBent;
    fingers["index"]  = indexBent;
    fingers["middle"] = middleBent;
    fingers["ring"]   = ringBent;
    fingers["little"] = littleBent;

    ultrasonic["valid"] = distanceValid;
    if (distanceValid) {
      ultrasonic["distance_cm"] = serialized(String(distanceCm, 1));
    } else {
      ultrasonic["distance_cm"] = nullptr;
    }

    doc["gesture_code"] = gestureCode;

    // 6. Serialize JSON to char buffer
    char jsonBuffer[384];
    size_t length = serializeJson(doc, jsonBuffer);

    // 7. Transmit UDP packet to host workstation
    if (WiFi.status() == WL_CONNECTED && length > 0) {
      int beginRes = udp.beginPacket(RECEIVER_IP, RECEIVER_PORT);
      if (beginRes == 1) {
        size_t written = udp.write((const uint8_t*)jsonBuffer, length);
        int endRes = udp.endPacket();
        lastSendSuccess = (written == length && endRes == 1);
      } else {
        lastSendSuccess = false;
      }
    } else {
      lastSendSuccess = false;
    }
  }

  // -----------------------------------------------------------------------
  // Task B: Readable Serial Diagnostics (1000 ms interval / 1 Hz)
  // -----------------------------------------------------------------------
  if (currentMillis - lastDiagnosticTime >= DIAGNOSTIC_INTERVAL_MS) {
    lastDiagnosticTime = currentMillis;
    printDiagnostics();
  }
}
