/**
 * MUDRA Module 2 - Window Formation
 *
 * Manages fixed, non-overlapping windows of exactly WINDOW_SIZE packets.
 * Handles mode-transition boundaries by invalidating the interrupted window
 * and seeding the fresh window with the transition packet.
 *
 * Robustly handles rapid mode switches occurring across consecutive packets
 * by logging a diagnostic warning and cleanly re-indexing the window counter to 1
 * with the new-mode packet, ensuring the pipeline never stalls or throws unhandled exceptions.
 */

const { WINDOW_SIZE, VALID_MODES } = require("./config");
const { isAllFingersOpen } = require("./validate");

/**
 * Creates a window manager instance.
 *
 * @param {object} [options]
 * @param {number} [options.windowSize]
 * @param {Function} [options.logger] Optional custom logger for diagnostic warnings
 * @returns {object} Window manager API
 */
function createWindowManager(options = {}) {
  const windowSize = options.windowSize || WINDOW_SIZE;
  const warnLogger = options.logger || console.warn;
  let packets = [];
  let consecutiveRest = 0;
  let recentRestPackets = [];

  /**
   * Adds a packet to the current window buffer.
   *
   * @param {object} packet
   * @returns {{
   *   status: "COLLECTING" | "WINDOW_COMPLETE" | "MODE_TRANSITION",
   *   window?: Array<object>,
   *   interruptedPackets?: Array<object>,
   *   count?: number
   * }}
   */
  function addPacket(packet) {
    try {
      // Graceful handling of invalid or non-object packets
      if (!packet || typeof packet !== "object") {
        consecutiveRest = 0;
        recentRestPackets = [];
        packets.push(packet);
        if (packets.length === windowSize) {
          const fullWindow = packets;
          packets = [];
          return {
            status: "WINDOW_COMPLETE",
            window: fullWindow
          };
        }
        return {
          status: "COLLECTING",
          count: packets.length
        };
      }

      // Mode-transition check: if buffer has packets and incoming valid mode differs
      if (packets.length > 0) {
        const firstPacket = packets[0];
        const currentMode = firstPacket && firstPacket.mode;
        const newMode = packet.mode;

        if (
          VALID_MODES.includes(currentMode) &&
          VALID_MODES.includes(newMode) &&
          currentMode !== newMode
        ) {
          const interrupted = packets;
          // Cleanly re-index the window counter to 1 with the new-mode packet
          packets = [packet];
          consecutiveRest = isAllFingersOpen(packet) ? 1 : 0;
          recentRestPackets = isAllFingersOpen(packet) ? [packet] : [];

          // Diagnostic warning for rapid mode switches (including consecutive packets)
          warnLogger(
            `[MUDRA Module 2 WindowManager] Rapid mode switch detected: mode changed from ${currentMode} to ${newMode} across consecutive packets (interrupted window had ${interrupted.length} packet(s)). Re-indexing window counter to 1 with new mode.`
          );

          return {
            status: "MODE_TRANSITION",
            interruptedPackets: interrupted,
            count: 1
          };
        }
      }

      // Track consecutive all-fingers-open REST packets
      if (isAllFingersOpen(packet)) {
        consecutiveRest++;
        recentRestPackets.push(packet);
        if (recentRestPackets.length > windowSize) {
          recentRestPackets.shift();
        }
      } else {
        consecutiveRest = 0;
        recentRestPackets = [];
      }

      // If full REST window (10/10 all-open) has been reached
      if (consecutiveRest === windowSize) {
        const fullRestWindow = [...recentRestPackets];
        packets = [];
        consecutiveRest = 0;
        recentRestPackets = [];
        return {
          status: "WINDOW_COMPLETE",
          window: fullRestWindow
        };
      }

      packets.push(packet);

      if (packets.length === windowSize) {
        const fullWindow = packets;
        packets = [];
        return {
          status: "WINDOW_COMPLETE",
          window: fullWindow
        };
      }

      return {
        status: "COLLECTING",
        count: packets.length
      };
    } catch (err) {
      warnLogger(
        `[MUDRA Module 2 WindowManager] Exception in addPacket: ${err.message}. Preserving stability and re-indexing window.`
      );
      packets = packet ? [packet] : [];
      consecutiveRest = 0;
      recentRestPackets = [];
      return {
        status: "COLLECTING",
        count: packets.length
      };
    }
  }

  function getCount() {
    return packets.length;
  }

  function getPackets() {
    return [...packets];
  }

  function resetConsecutiveRest() {
    consecutiveRest = 0;
    recentRestPackets = [];
  }

  function clear() {
    packets = [];
    consecutiveRest = 0;
    recentRestPackets = [];
  }

  function reset() {
    clear();
  }

  return {
    addPacket,
    getCount,
    getPackets,
    clear,
    reset,
    resetConsecutiveRest
  };
}

module.exports = {
  createWindowManager
};
