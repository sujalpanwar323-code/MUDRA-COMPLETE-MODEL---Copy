/**
 * MUDRA Module 2 - Input Validation
 *
 * Validates incoming Module 1 packet structure and field types.
 * Strictly avoids coercion, guessing, or default fallbacks.
 */

const {
  FINGER_ORDER,
  VALID_MODES,
  VALID_ZONES,
  REASON_CODES
} = require("./config");

/**
 * Validates a single Module 1 packet strictly against the input specification.
 *
 * @param {any} packet
 * @returns {{ valid: boolean, reason?: string, details?: string }}
 */
function validatePacket(packet) {
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) {
    return {
      valid: false,
      reason: REASON_CODES.INVALID_PACKET,
      details: "Packet must be a non-null object"
    };
  }

  // Validate mode
  if (
    packet.mode === undefined ||
    typeof packet.mode !== "number" ||
    !Number.isInteger(packet.mode) ||
    !VALID_MODES.includes(packet.mode)
  ) {
    return {
      valid: false,
      reason: REASON_CODES.INVALID_MODE,
      details: "Packet mode must be integer 0 or 1"
    };
  }

  if (packet.emergency_mode !== undefined &&
      typeof packet.emergency_mode !== "boolean") {
    return {
      valid: false,
      reason: REASON_CODES.INVALID_PACKET,
      details: "Packet emergency_mode must be a Boolean when provided"
    };
  }

  // Validate fingers object
  if (!packet.fingers || typeof packet.fingers !== "object" || Array.isArray(packet.fingers)) {
    return {
      valid: false,
      reason: REASON_CODES.INVALID_PACKET,
      details: "Packet fingers must be a non-null object"
    };
  }

  // Validate all five finger booleans
  for (const finger of FINGER_ORDER) {
    if (typeof packet.fingers[finger] !== "boolean") {
      return {
        valid: false,
        reason: REASON_CODES.INVALID_PACKET,
        details: `Finger '${finger}' must be a boolean`
      };
    }
  }

  // Validate ultrasonic object
  if (
    !packet.ultrasonic ||
    typeof packet.ultrasonic !== "object" ||
    Array.isArray(packet.ultrasonic)
  ) {
    return {
      valid: false,
      reason: REASON_CODES.INVALID_PACKET,
      details: "Packet ultrasonic must be a non-null object"
    };
  }

  // Validate ultrasonic.stable flag
  if (typeof packet.ultrasonic.stable !== "boolean") {
    return {
      valid: false,
      reason: REASON_CODES.INVALID_PACKET,
      details: "Ultrasonic stable flag must be a boolean"
    };
  }

  // If stable is true, zone must be valid integer 1, 2, or 3
  if (packet.ultrasonic.stable === true) {
    const zone = packet.ultrasonic.zone;
    if (
      zone === undefined ||
      typeof zone !== "number" ||
      !Number.isInteger(zone) ||
      !VALID_ZONES.includes(zone)
    ) {
      return {
        valid: false,
        reason: REASON_CODES.INVALID_STABLE_ZONE,
        details: "Stable ultrasonic zone must be integer 1, 2, or 3"
      };
    }
  }

  return { valid: true };
}

/**
 * Checks whether all five fingers in a packet are open (false).
 *
 * @param {object} packet
 * @returns {boolean}
 */
function isAllFingersOpen(packet) {
  if (!packet || !packet.fingers) return false;
  return FINGER_ORDER.every(finger => packet.fingers[finger] === false);
}

/**
 * Checks whether any finger in a packet is bent (true).
 *
 * @param {object} packet
 * @returns {boolean}
 */
function hasAnyFingerBent(packet) {
  if (!packet || !packet.fingers) return false;
  return FINGER_ORDER.some(finger => packet.fingers[finger] === true);
}

module.exports = {
  validatePacket,
  isAllFingersOpen,
  hasAnyFingerBent
};
