// Backwards-compatible entry point. All UDP ingestion uses the canonical
// validated bridge so the receiver cannot drift from the production pipeline.
const bridge = require("./udp_bridge");

if (require.main === module) {
  bridge.startBridge().catch(error => {
    console.error(`[PIPELINE STARTUP ERROR] ${error.message}`);
    process.exitCode = 1;
    void bridge.closeBridge();
  });
  const shutdown = () => {
    bridge.closeBridge().catch(error => {
      console.error(`[PIPELINE SHUTDOWN ERROR] ${error.message}`);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.on("message", message => {
    if (message && message.type === "shutdown") {
      bridge.closeBridge().then(() => {
        if (process.connected) process.disconnect();
      }).catch(error => {
        console.error(`[PIPELINE SHUTDOWN ERROR] ${error.message}`);
        process.exitCode = 1;
      });
    }
  });
}

module.exports = bridge;
