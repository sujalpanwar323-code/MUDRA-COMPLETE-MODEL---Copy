/**
 * MUDRA Module 2 - Signing Lifecycle State Machine
 *
 * Tracks IDLE vs COLLECTING states and accumulates accepted gestures in sequence.
 * Emits BATCH_READY only on strict REST, or EMPTY_SIGNING_SEQUENCE if no valid
 * gestures accumulated before rest.
 *
 * Ensures clean state wiping on EMPTY_SIGNING_SEQUENCE and explicit reset()
 * to prevent sequence counter bleeding, stale pending gestures, or partial window bleed.
 */

const {
  STATE_IDLE,
  STATE_COLLECTING,
  RESULT_TYPES,
  REASON_CODES
} = require("./config");

/**
 * Creates an isolated state machine instance.
 *
 * @param {object} [options]
 * @param {object} [options.windowManager] Optional window manager reference for buffer clearing
 * @param {Function} [options.clearBuffer] Optional partial window buffer cleanup callback
 * @returns {object} State machine instance
 */
function createStateMachine(options = {}) {
  let currentState = STATE_IDLE;
  let gestures = [];
  let sequenceCounter = 0;
  const windowManager = options.windowManager || null;
  const clearBufferCallback = options.clearBuffer || null;

  function getState() {
    return currentState;
  }

  function getGestures() {
    return [...gestures];
  }

  function getSequenceCounter() {
    return sequenceCounter;
  }

  function startCollecting() {
    currentState = STATE_COLLECTING;
  }

  function addGesture(gesture) {
    sequenceCounter += 1;
    gestures.push({
      ...gesture,
      sequence_id: sequenceCounter
    });
  }

  /**
   * Completely clears all internal state, sequence counters, pending gestures,
   * and partial window buffers.
   */
  function clearAllState() {
    currentState = STATE_IDLE;
    gestures = [];
    sequenceCounter = 0;

    if (windowManager && typeof windowManager.clear === "function") {
      windowManager.clear();
    }
    if (windowManager && typeof windowManager.reset === "function") {
      windowManager.reset();
    }
    if (typeof clearBufferCallback === "function") {
      clearBufferCallback();
    }
    if (typeof options.onClear === "function") {
      options.onClear();
    }
  }

  /**
   * Finalizes the current signing sequence upon detection of strict REST.
   *
   * @returns {{
   *   type: string,
   *   batch?: { type: "gesture_batch", gestures: Array<object> }
   * }}
   */
  function handleRest() {
    if (gestures.length > 0) {
      const batch = {
        type: "gesture_batch",
        gestures: gestures.map((g, index) => ({
          sequence_id: g.sequence_id || index + 1,
          mode: g.mode,
          flex: g.flex,
          distance_state: g.distance_state
        }))
      };
      clearAllState();
      return {
        type: RESULT_TYPES.BATCH_READY,
        batch
      };
    }

    // EMPTY_SIGNING_SEQUENCE: entirely clear all sequence counters,
    // pending gesture arrays, and partial window buffers
    clearAllState();
    return {
      type: RESULT_TYPES.EMPTY_SIGNING_SEQUENCE
    };
  }

  /**
   * Explicit reset: entirely clears all internal sequence counters,
   * pending gesture arrays, and partial window buffers.
   */
  function reset() {
    clearAllState();
  }

  return {
    getState,
    getGestures,
    getSequenceCounter,
    startCollecting,
    addGesture,
    handleRest,
    reset,
    clear: clearAllState,
    clearAllState
  };
}

module.exports = {
  createStateMachine
};

