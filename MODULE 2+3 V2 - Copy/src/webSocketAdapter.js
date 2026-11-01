const EventEmitter = require("node:events");
const WebSocket = require("ws");
const { serializeOutboundPayload } = require("./outputAdapter");

function createWebSocketAdapter(options = {}) {
    if (options.role !== "server" && options.role !== "client") {
        throw new TypeError(
            'WebSocket role must be explicitly configured as "server" or "client".'
        );
    }
    if (options.role === "server" &&
        (typeof options.host !== "string" ||
            options.host.trim() === "" ||
            !Number.isInteger(options.port) ||
            options.port < 0 ||
            options.port > 65535)) {
        throw new TypeError(
            "Server mode requires a host and a port between 0 and 65535."
        );
    }
    if (options.role === "client" &&
        (typeof options.url !== "string" ||
            !/^wss?:\/\//i.test(options.url))) {
        throw new TypeError("Client mode requires a ws:// or wss:// URL.");
    }

    const events = new EventEmitter();
    const clients = new Set();
    let server = null;
    let client = null;
    let startPromise = null;
    let closePromise = null;
    let closed = false;
    let started = false;

    function reportError(error) {
        events.emit("transportError", error);
    }

    function startServer() {
        server = new WebSocket.Server({
            host: options.host,
            port: options.port
        });
        server.on("error", reportError);
        server.on("close", () => { started = false; });
        server.on("connection", socket => {
            clients.add(socket);
            socket.on("close", () => clients.delete(socket));
            socket.on("error", reportError);
            socket.on("message", message => {
                events.emit("frontendMessage", message, socket);
            });

            // WebSocket Handshake / Reconnection State Sync:
            // Send initial connection confirmation payload immediately upon connection
            // so frontend client UI can verify its sync state after initial connect or reconnect.
            try {
                const handshake = JSON.stringify({
                    type: "CONNECTION_ESTABLISHED"
                });
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(handshake, error => {
                        if (error) reportError(error);
                    });
                } else {
                    socket.once("open", () => {
                        socket.send(handshake, error => {
                            if (error) reportError(error);
                        });
                    });
                }
            } catch (err) {
                reportError(err);
            }
        });

        return new Promise((resolve, reject) => {
            const onListening = () => {
                server.removeListener("error", onInitialError);
                started = true;
                const address = server.address();
                resolve({
                    role: "server",
                    host: address.address,
                    port: address.port
                });
            };
            const onInitialError = error => {
                server.removeListener("listening", onListening);
                reject(error);
            };
            server.once("listening", onListening);
            server.once("error", onInitialError);
        });
    }

    function startClient() {
        client = new WebSocket(options.url);
        client.on("error", reportError);
        client.on("close", () => { started = false; });

        return new Promise((resolve, reject) => {
            const onOpen = () => {
                client.removeListener("error", onInitialError);
                started = true;
                resolve({ role: "client", url: options.url });
            };
            const onInitialError = error => {
                client.removeListener("open", onOpen);
                reject(error);
            };
            client.once("open", onOpen);
            client.once("error", onInitialError);
        });
    }

    function start() {
        if (closed) {
            return Promise.reject(
                new Error("The WebSocket adapter has already been closed.")
            );
        }
        if (!startPromise) {
            startPromise = options.role === "server"
                ? startServer()
                : startClient();
        }
        return startPromise;
    }

    function sendControlMessage(socket, message) {
        if (options.role !== "server") {
            throw new Error("Control messages can only be sent by a server adapter.");
        }
        if (!clients.has(socket) || socket.readyState !== WebSocket.OPEN) {
            return {
                success: false,
                status: "disconnected",
                message: "The frontend connection is no longer available."
            };
        }

        let serialized;
        try {
            serialized = JSON.stringify(message);
        } catch (error) {
            return {
                success: false,
                status: "failed",
                message: "The frontend control response could not be serialized.",
                error
            };
        }

        try {
            socket.send(serialized, error => {
                if (error) {
                    reportError(error);
                }
            });
        } catch (error) {
            reportError(error);
            return {
                success: false,
                status: "failed",
                message: "The frontend control response could not be sent."
            };
        }

        return {
            success: true,
            status: "send_accepted"
        };
    }

    function send(payload) {
        const serialized = serializeOutboundPayload(payload);
        const sockets = options.role === "server"
            ? [...clients]
            : client
                ? [client]
                : [];
        const openSockets = sockets.filter(socket =>
            socket.readyState === WebSocket.OPEN);

        if (openSockets.length === 0) {
            return {
                success: false,
                status: "disconnected",
                message: "No frontend WebSocket connection is available."
            };
        }

        let accepted = 0;
        for (const socket of openSockets) {
            try {
                socket.send(serialized, error => {
                    if (error) {
                        reportError(error);
                    }
                });
                accepted += 1;
            } catch (error) {
                reportError(error);
            }
        }

        if (accepted === 0) {
            return {
                success: false,
                status: "failed",
                message: "The WebSocket transport rejected the send operation."
            };
        }

        return {
            success: true,
            status: "send_accepted",
            recipients: accepted,
            message: "The transport accepted the send operation; peer receipt is not confirmed."
        };
    }

    function close() {
        if (closePromise) {
            return closePromise;
        }
        closed = true;

        closePromise = (async () => {
            if (options.role === "server" &&
                server &&
                !server.address() &&
                startPromise) {
                await startPromise;
            }

            if (options.role === "client" && client) {
                const socket = client;
                client = null;
                if (socket.readyState === WebSocket.CLOSED) {
                    return;
                }
                await new Promise(resolve => {
                    socket.once("close", resolve);
                    socket.close();
                });
                return;
            }

            if (!server || !server.address()) {
                return;
            }
            for (const socket of clients) {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.close(1000, "Module 3 shutting down");
                } else if (socket.readyState === WebSocket.CONNECTING) {
                    socket.terminate();
                }
            }
            await new Promise((resolve, reject) => {
                server.close(error => error ? reject(error) : resolve());
            });
        })();
        return closePromise;
    }

    return {
        role: options.role,
        host: options.role === "server" ? options.host : undefined,
        port: options.role === "server" ? options.port : undefined,
        get started() {
            return started;
        },
        start,
        send,
        sendControlMessage,
        close,
        on: (event, listener) => events.on(event, listener),
        off: (event, listener) => events.off(event, listener)
    };
}

module.exports = {
    createWebSocketAdapter,
    createWebSocketServer: (options = {}) =>
        createWebSocketAdapter({ ...options, role: "server" })
};
