# MUDRA — Module 1: Hardware Glove Node

This directory contains the firmware and hardware documentation for **Module 1 (ESP32 Sensor Glove Node)** in the MUDRA sign language translation system.

Module 1 captures 5-finger contact states and palm-to-chest ultrasonic distance, packages the raw measurements and computed 6-bit gesture representations into JSON datagrams, and broadcasts them over local Wi-Fi via UDP to the host workstation running `udp_bridge.js`.

---

## 1. Hardware Overview & Bill of Materials

| Component | Quantity | Specification / Description |
| :--- | :--- | :--- |
| **Microcontroller** | 1 | ESP32 Development Board (e.g., NodeMCU ESP32, ESP-WROOM-32) |
| **Finger Contact Sensors** | 5 | Homemade binary digital contact switches (mounted along 5 fingers) |
| **Ultrasonic Sensor** | 1 | HC-SR04 (5V VCC, with 3.3V Echo divider) ultrasonic distance sensor |
| **Mode Toggle Button** | 1 | Momentary tactile push button (active-LOW with internal pull-up) |
| **Echo Level Shifter Resistors**| 2 | 1 kΩ and 2 kΩ resistors (voltage divider for 5V HC-SR04 Echo pin) |
| **Power Source** | 1 | 5V Power Bank / LiPo battery with 3.3V/5V LDO or USB power |

---

## 2. GPIO Pinout Table

> [!IMPORTANT]
> The five finger sensors are **digital contact switches**, not analog resistive flex sensors. Every switch is wired between its GPIO and common ground, configured using `pinMode(pin, INPUT_PULLUP)`. No analog reads (`analogRead`), ADC channels, or calibration thresholds are used.

| Component / Function | ESP32 GPIO | Pin Mode | Logic State / Description |
| :--- | :--- | :--- | :--- |
| **Thumb Contact Switch** | GPIO 13 | `INPUT_PULLUP` | LOW = bent/active (`true`), HIGH = straight/inactive (`false`) |
| **Index Contact Switch** | GPIO 14 | `INPUT_PULLUP` | LOW = bent/active (`true`), HIGH = straight/inactive (`false`) |
| **Middle Contact Switch** | GPIO 25 | `INPUT_PULLUP` | LOW = bent/active (`true`), HIGH = straight/inactive (`false`) |
| **Ring Contact Switch** | GPIO 26 | `INPUT_PULLUP` | LOW = bent/active (`true`), HIGH = straight/inactive (`false`) |
| **Little Contact Switch** | GPIO 27 | `INPUT_PULLUP` | LOW = bent/active (`true`), HIGH = straight/inactive (`false`) |
| **Mode Toggle Button** | GPIO 19 | `INPUT_PULLUP` | Momentary tactile button to GND; toggles Mode 0 ↔ Mode 1 |
| **Ultrasonic Trigger** | GPIO 5 | `OUTPUT` | 10 µs HIGH pulse to trigger ping |
| **Ultrasonic Echo** | GPIO 18 | `INPUT` | Measures echo pulse width (via 1kΩ/2kΩ voltage divider) |
| **VCC** | 5V / VIN | Power | 5V for HC-SR04 VCC |
| **GND** | GND | Ground | Common system ground |

---

## 3. Circuit Wiring & Schematics

### 3.1 Digital Contact Switch Circuit
Each of the 5 finger sensors is a homemade contact switch. When the finger is straight, the contact switch is open. When the finger is bent, the contact closes to ground.

```text
  ESP32 GPIO (13, 14, 25, 26, 27)
         │
    [ Internal Pullup (~45kΩ to 3.3V) ]
         │
         ├─── Contact Switch Terminal 1
         │
       [ Contact Switch ] (Bent = CLOSED, Straight = OPEN)
         │
         └─── Contact Switch Terminal 2 ─── GND
```

- **Open (Straight):** Line is pulled HIGH by internal pull-up → `digitalRead() == HIGH` → `false`
- **Closed (Bent):** Line is pulled to common GND → `digitalRead() == LOW` → `true`

### 3.2 HC-SR04 Ultrasonic Voltage Divider
Standard HC-SR04 modules require 5V VCC and output a 5V logic pulse on the `Echo` pin. Because ESP32 GPIOs tolerate a maximum of 3.3V, use a 1 kΩ / 2 kΩ voltage divider to step down the 5V Echo signal to ~3.3V:

```text
  HC-SR04 Echo (5V Pulse)
          │
       [ 1 kΩ ]
          │
          ├────── ESP32 GPIO 18 (Echo Input, ~3.3V)
          │
       [ 2 kΩ ]
          │
         GND
```

### 3.3 Mode Toggle Push Button
Connect one terminal of the tactile switch to **GPIO 19** and the other terminal to **GND**. The internal pull-up resistor keeps the line `HIGH` when released, and pulls to `LOW` when pressed. The firmware applies software debouncing so each press toggles the mode exactly once (Mode 0 ↔ Mode 1).

---

## 4. Six-Bit Gesture Encoding

Module 1 calculates a deterministic 6-bit gesture code combining operating mode and the five finger contact states:

| Bit Position | Semantic Field | Bit Value = 0 | Bit Value = 1 |
| :---: | :--- | :--- | :--- |
| **Bit 5** | Operating Mode | Mode 0 (Standard) | Mode 1 (Secondary) |
| **Bit 4** | Thumb | Straight (`false`) | Bent (`true`) |
| **Bit 3** | Index | Straight (`false`) | Bent (`true`) |
| **Bit 2** | Middle | Straight (`false`) | Bent (`true`) |
| **Bit 1** | Ring | Straight (`false`) | Bent (`true`) |
| **Bit 0** | Little | Straight (`false`) | Bent (`true`) |

### Example:
- Mode = 1
- Thumb = Straight (0), Index = Bent (1), Middle = Straight (0), Ring = Straight (0), Little = Bent (1)
- Binary representation: `101001`
- Decimal representation: `41` (32 + 8 + 1)

---

## 5. Wi-Fi & Destination Configuration

Open `module1/glove_node.ino` and configure your network settings:

```cpp
// 1. Wi-Fi Credentials (2.4 GHz network)
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// 2. Host Computer IPv4 running udp_bridge.js
const char* RECEIVER_IP   = "192.168.1.100"; // Replace with your laptop's LAN IPv4
const int   RECEIVER_PORT = 5005;
const int   LOCAL_PORT    = 5006;
```

> [!NOTE]
> Do NOT set `RECEIVER_IP` to `0.0.0.0` or `127.0.0.1`. It must be the actual IPv4 address of the host workstation on the same local network.

---

## 6. Firmware Flashing Guide

### Using Arduino IDE:
1. **Install ESP32 Board Support:**
   - Go to **File → Preferences → Additional Board Manager URLs**.
   - Add: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
   - Open **Tools → Board → Boards Manager**, search for `esp32`, and install.
2. **Install ArduinoJson Library:**
   - Open **Sketch → Include Library → Manage Libraries**.
   - Search for `ArduinoJson` and install version `6.x` or `7.x`. (The firmware supports both versions).
3. **Select Board & Port:**
   - Select **Tools → Board → ESP32 Dev Module** (or your specific ESP32 variant).
   - Set **Upload Speed** to `921600`.
   - Select the corresponding COM port.
4. **Compile & Upload:**
   - Open `module1/glove_node.ino`.
   - Click **Upload**.
5. **Open Serial Monitor:**
   - Set baud rate to `115200`.
   - Observe the 1 Hz diagnostic summary.

---

## 7. Wire Data Protocol (JSON UDP Broadcast)

Every 100 ms (10 Hz sampling rate), the glove node broadcasts a UDP datagram to port `5005`:

```json
{
  "device": "MUDRA_01",
  "seq": 104,
  "mode": 0,
  "timestamp_ms": 20800,
  "fingers": {
    "thumb": true,
    "index": false,
    "middle": false,
    "ring": false,
    "little": false
  },
  "ultrasonic": {
    "valid": true,
    "distance_cm": 12.8
  },
  "gesture_code": 16
}
```

When no valid echo is received or the measurement is outside supported physical limits (2.0 to 400.0 cm), ultrasonic is reported honestly without fabricating arbitrary distances:

```json
{
  "device": "MUDRA_01",
  "seq": 105,
  "mode": 0,
  "timestamp_ms": 20900,
  "fingers": {
    "thumb": false,
    "index": false,
    "middle": false,
    "ring": false,
    "little": false
  },
  "ultrasonic": {
    "valid": false,
    "distance_cm": null
  },
  "gesture_code": 0
}
```

This packet is ingested by `udp_bridge.js`, validated, and passed into Module 2 (`backend/module2/index.js`).
