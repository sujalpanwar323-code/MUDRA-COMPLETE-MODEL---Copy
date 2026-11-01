const path = require("node:path");
const WebSocket = require(path.join(
  __dirname,
  "..",
  "3 INTEGRATION V2",
  "node_modules",
  "ws"
));

const WS_URL = process.env.MUDRA_WS_URL || "ws://127.0.0.1:8080";
const socket = new WebSocket(WS_URL);

function log(event, details = "") {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${event}${details ? ` ${details}` : ""}`);
}

socket.on("open", () => log("CONNECTED", WS_URL));

socket.on("message", raw => {
  let message;
  try {
    message = JSON.parse(raw.toString("utf8"));
  } catch {
    log("INVALID_JSON", raw.toString("utf8"));
    return;
  }

  switch (message.type) {
    case "CONNECTION_ESTABLISHED":
      log("BACKEND_READY");
      break;
    case "telemetry":
      console.log(JSON.stringify({
        time: new Date().toLocaleTimeString(),
        type: message.type,
        device: message.device,
        seq: message.seq,
        mode: message.mode,
        emergency_mode: message.emergency_mode,
        fingers: message.rawFingers,
        distance_cm: message.ultrasonic?.distance_cm ?? null,
        distance_state: message.distance_state,
        module2: message.m2State,
        module2_event: message.m2LastEvent
      }));
      break;
    case "recognized_keywords":
      log("MODULE3_RECOGNIZED", JSON.stringify(message.keywords));
      break;
    case "EMERGENCY_RESULT":
      log("EMERGENCY", JSON.stringify(message));
      break;
    default:
      log(message.type || "BACKEND_MESSAGE", JSON.stringify(message));
  }
});

socket.on("error", error => {
  log("CONNECTION_ERROR", `${error.message}. Is the pipeline running on ${WS_URL}?`);
  process.exitCode = 1;
});

socket.on("close", () => log("DISCONNECTED"));

function shutdown() {
  if (socket.readyState === WebSocket.CLOSED) return;
  socket.close(1000, "Watcher stopped");
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
