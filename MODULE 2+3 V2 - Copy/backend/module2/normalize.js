/**
 * MUDRA Module 2 - Sensor Normalization
 *
 * Evaluates a complete 10-packet window:
 * - Validates packets and mode consistency.
 * - Detects strict REST (10/10 all-fingers-open).
 * - Majority-votes fingers (6/10 rule).
 * - Majority-votes stable ultrasonic zones (6/10 rule).
 * - Produces normalized gesture object or structured rejection.
 */

const {
  WINDOW_SIZE,
  REQUIRED_MAJORITY,
  FINGER_ORDER,
  FINGER_TO_KEY,
  ZONE_TO_DISTANCE_STATE,
  VALID_ZONES,
  REASON_CODES
} = require("./config");
const { validatePacket, isAllFingersOpen } = require("./validate");

/**
 * Evaluates a complete window of packets.
 *
 * @param {Array<object>} packets Array of packets (must be exactly WINDOW_SIZE)
 * @returns {{
 *   valid: boolean,
 *   isRest?: boolean,
 *   gesture?: { mode: number, flex: string, distance_state: string },
 *   reason?: string,
 *   details?: string
 * }}
 */
function evaluateWindow(packets) {
  if (!Array.isArray(packets) || packets.length !== WINDOW_SIZE) {
    return {
      valid: false,
      isRest: false,
      reason: REASON_CODES.INCOMPLETE_WINDOW,
      details: `Expected window size of ${WINDOW_SIZE}, received ${packets ? packets.length : 0}`
    };
  }

  // 1. Validate each packet structure & types
  for (let i = 0; i < packets.length; i++) {
    const valResult = validatePacket(packets[i]);
    if (!valResult.valid) {
      return {
        valid: false,
        isRest: false,
        reason: valResult.reason,
        details: `Packet index ${i}: ${valResult.details}`
      };
    }
  }

  // 2. Check mode consistency across all 10 packets
  const windowMode = packets[0].mode;
  for (let i = 1; i < packets.length; i++) {
    if (packets[i].mode !== windowMode) {
      return {
        valid: false,
        isRest: false,
        reason: REASON_CODES.MODE_CHANGED,
        details: `Mode changed from ${windowMode} to ${packets[i].mode} at packet index ${i}`
      };
    }
  }

  // 3. Check strict 10/10 all-fingers-open REST condition
  const isStrictRest = packets.every(isAllFingersOpen);
  if (isStrictRest) {
    return {
      valid: true,
      isRest: true
    };
  }

  // 4. Per-finger majority voting (thumb -> index -> middle -> ring -> little)
  const flexObj = {};
  for (const finger of FINGER_ORDER) {
    let trueCount = 0;
    let falseCount = 0;

    for (const packet of packets) {
      if (packet.fingers[finger] === true) {
        trueCount++;
      } else {
        falseCount++;
      }
    }

    const key = FINGER_TO_KEY[finger];
    if (trueCount >= REQUIRED_MAJORITY) {
      flexObj[key] = true;
    } else if (falseCount >= REQUIRED_MAJORITY) {
      flexObj[key] = false;
    } else {
      return {
        valid: false,
        isRest: false,
        reason: REASON_CODES.FINGER_VOTE_TIE,
        details: `Finger '${finger}' vote tie: ${trueCount} true, ${falseCount} false`
      };
    }
  }

  // 5. Ultrasonic distance majority voting (stable readings only)
  const zoneCounts = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < packets.length; i++) {
    const { stable, zone } = packets[i].ultrasonic;
    if (stable === true) {
      if (!VALID_ZONES.includes(zone)) {
        return {
          valid: false,
          isRest: false,
          reason: REASON_CODES.INVALID_STABLE_ZONE,
          details: `Packet index ${i} stable ultrasonic reading has invalid zone: ${zone}`
        };
      }
      zoneCounts[zone]++;
    }
  }

  let winningZone = null;
  for (const zone of VALID_ZONES) {
    if (zoneCounts[zone] >= REQUIRED_MAJORITY) {
      winningZone = zone;
      break;
    }
  }

  if (winningZone === null) {
    return {
      valid: false,
      isRest: false,
      reason: REASON_CODES.DISTANCE_NO_MAJORITY,
      details: `No ultrasonic zone achieved ${REQUIRED_MAJORITY} stable votes. Counts: ${JSON.stringify(zoneCounts)}`
    };
  }

  const distanceState = ZONE_TO_DISTANCE_STATE[winningZone];

  return {
    valid: true,
    isRest: false,
    gesture: {
      mode: windowMode,
      flex: flexObj,
      distance_state: distanceState
    }
  };
}

module.exports = {
  evaluateWindow
};
