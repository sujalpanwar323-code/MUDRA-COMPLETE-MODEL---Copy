/**
 * MUDRA Module 2 - Public Entry Point
 *
 * Implements createModule2() factory function providing:
 * - processReading(packet)
 * - reset()
 *
 * Coordinates validation, windowing, deterministic normalization,
 * and signing lifecycle state machine.
 */

const {
  WINDOW_SIZE,
  STATE_IDLE,
  STATE_COLLECTING,
  RESULT_TYPES,
  REASON_CODES
} = require("./config");
const { hasAnyFingerBent } = require("./validate");
const { evaluateWindow } = require("./normalize");
const { createWindowManager } = require("./windowManager");
const { createStateMachine } = require("./stateMachine");

/**
 * Creates an independent Module 2 processor instance.
 *
 * @param {object} [options]
 * @param {number} [options.windowSize]
 * @returns {{
 *   processReading: (packet: any) => object,
 *   reset: () => void,
 *   getState: () => string,
 *   getPendingGestures: () => Array<object>
 * }}
 */
function createModule2(options = {}) {
  const windowSize = options.windowSize || WINDOW_SIZE;
  const windowManager = createWindowManager({ windowSize });
  const stateMachine = createStateMachine({ windowManager });

  /**
   * Processes a single Module 1 sensor packet.
   *
   * @param {any} packet
   * @returns {object} Structured result event
   */
  function processReading(packet) {
    const currentState = stateMachine.getState();

    // 1. While IDLE: wait until any finger bends
    if (currentState === STATE_IDLE) {
      if (!hasAnyFingerBent(packet)) {
        return { type: RESULT_TYPES.WAITING };
      }

      // First bent finger packet starts collection and is packet 1
      stateMachine.startCollecting();
      const addResult = windowManager.addPacket(packet);

      return {
        type: RESULT_TYPES.WINDOW_COLLECTING,
        readings: addResult.count
      };
    }

    // 2. While COLLECTING: add packet to current window
    const addResult = windowManager.addPacket(packet);

    // Case A: Mode shift mid-window
    if (addResult.status === "MODE_TRANSITION") {
      return {
        type: RESULT_TYPES.WINDOW_REJECTED,
        reason: REASON_CODES.MODE_CHANGED,
        details: "Mode changed mid-window; interrupted window rejected and fresh window started"
      };
    }

    // Case B: Window still filling
    if (addResult.status === "COLLECTING") {
      return {
        type: RESULT_TYPES.WINDOW_COLLECTING,
        readings: addResult.count
      };
    }

    // Case C: Exactly 10 packets collected -> evaluate window
    if (addResult.status === "WINDOW_COMPLETE") {
      const evalResult = evaluateWindow(addResult.window);

      // REST window detected
      if (evalResult.isRest) {
        const restResult = stateMachine.handleRest();
        // Ensure partial window buffers are fully wiped on empty sequence or batch completion
        windowManager.clear();
        return restResult;
      }

      // Valid gesture window detected
      if (evalResult.valid) {
        stateMachine.addGesture(evalResult.gesture);
        if (typeof windowManager.resetConsecutiveRest === "function") {
          windowManager.resetConsecutiveRest();
        }
        return {
          type: RESULT_TYPES.GESTURE_ACCEPTED,
          gesture: evalResult.gesture
        };
      }

      // Window rejected (e.g. finger tie, invalid packet, unstable distance, etc.)
      if (stateMachine.getGestures().length > 0) {
        if (typeof windowManager.resetConsecutiveRest === "function") {
          windowManager.resetConsecutiveRest();
        }
      }

      return {
        type: RESULT_TYPES.WINDOW_REJECTED,
        reason: evalResult.reason,
        details: evalResult.details
      };
    }

    return { type: RESULT_TYPES.WAITING };
  }

  /**
   * Explicitly clears internal state, pending gestures, and window buffer.
   */
  function reset() {
    windowManager.clear();
    stateMachine.reset();
  }

  return {
    processReading,
    reset,
    getState: () => stateMachine.getState(),
    getPendingGestures: () => stateMachine.getGestures(),
    getSequenceCounter: () => stateMachine.getSequenceCounter()
  };
}

module.exports = {
  createModule2
};
