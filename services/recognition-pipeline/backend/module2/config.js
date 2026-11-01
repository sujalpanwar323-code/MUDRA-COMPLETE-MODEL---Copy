/**
 * MUDRA Module 2 - Central Configuration & Constants
 *
 * All magic numbers, thresholds, finger ordering, and state constants
 * reside strictly here.
 */

const WINDOW_SIZE = 10;
const REQUIRED_MAJORITY = 6;
const FINGER_ORDER = Object.freeze(["thumb", "index", "middle", "ring", "little"]);
const FINGER_TO_KEY = Object.freeze({
  thumb: "f1",
  index: "f2",
  middle: "f3",
  ring: "f4",
  little: "f5"
});
const ZONE_TO_DISTANCE_STATE = Object.freeze({
  1: "LOW",
  2: "MID",
  3: "HIGH"
});
const VALID_MODES = Object.freeze([0, 1]);
const VALID_ZONES = Object.freeze([1, 2, 3]);

// Lifecycle states
const STATE_IDLE = "IDLE";
const STATE_COLLECTING = "COLLECTING";

// Internal result event types
const RESULT_TYPES = Object.freeze({
  WAITING: "WAITING",
  WINDOW_COLLECTING: "WINDOW_COLLECTING",
  WINDOW_REJECTED: "WINDOW_REJECTED",
  GESTURE_ACCEPTED: "GESTURE_ACCEPTED",
  BATCH_READY: "BATCH_READY",
  EMPTY_SIGNING_SEQUENCE: "EMPTY_SIGNING_SEQUENCE"
});

// Diagnostic reason codes
const REASON_CODES = Object.freeze({
  INVALID_PACKET: "INVALID_PACKET",
  INVALID_MODE: "INVALID_MODE",
  MODE_CHANGED: "MODE_CHANGED",
  FINGER_VOTE_TIE: "FINGER_VOTE_TIE",
  DISTANCE_NO_MAJORITY: "DISTANCE_NO_MAJORITY",
  INVALID_STABLE_ZONE: "INVALID_STABLE_ZONE",
  INCOMPLETE_WINDOW: "INCOMPLETE_WINDOW",
  EMPTY_SIGNING_SEQUENCE: "EMPTY_SIGNING_SEQUENCE"
});

module.exports = {
  WINDOW_SIZE,
  REQUIRED_MAJORITY,
  FINGER_ORDER,
  FINGER_TO_KEY,
  ZONE_TO_DISTANCE_STATE,
  VALID_MODES,
  VALID_ZONES,
  STATE_IDLE,
  STATE_COLLECTING,
  RESULT_TYPES,
  REASON_CODES
};
