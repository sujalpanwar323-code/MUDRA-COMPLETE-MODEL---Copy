/**
 * MUDRA Module 3 - WebSocket Server
 *
 * Implements frontend WebSocket server transport for live hardware streaming.
 * Sends an initial connection confirmation payload ({"type": "CONNECTION_ESTABLISHED"})
 * immediately upon connection so the UI client can verify its sync state after initial
 * connection or reconnecting from a disconnect.
 */

const WebSocket = require("ws");
const { createWebSocketAdapter } = require("../webSocketAdapter");

/**
 * Creates and starts a WebSocket server for Module 3 frontend transport,
 * ensuring the initial CONNECTION_ESTABLISHED confirmation is dispatched immediately.
 *
 * @param {object} [options]
 * @param {string} [options.host="127.0.0.1"]
 * @param {number} [options.port=8080]
 * @returns {object} WebSocket adapter configured in server mode
 */
function createWebSocketServer(options = {}) {
    return createWebSocketAdapter({
        role: "server",
        host: options.host || "127.0.0.1",
        port: options.port !== undefined ? options.port : 8080,
        ...options
    });
}

module.exports = {
    createWebSocketServer,
    createWebSocketAdapter
};
