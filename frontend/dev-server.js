import { createServer } from "vite";

let server;
let closing;

async function closeServer() {
  if (closing) return closing;
  closing = (async () => {
    if (server) await server.close();
  })();
  return closing;
}

try {
  server = await createServer({
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true
    }
  });
  await server.listen();
  server.printUrls();
  console.log("MUDRA Vite ready: http://127.0.0.1:5173");
} catch (error) {
  console.error(`[VITE STARTUP ERROR] ${error.message}`);
  process.exitCode = 1;
}

process.on("message", message => {
  if (message && message.type === "shutdown") {
    closeServer()
      .then(() => {
        process.exitCode = 0;
        if (process.connected) process.disconnect();
      })
      .catch(error => {
        console.error(`[VITE SHUTDOWN ERROR] ${error.message}`);
        process.exitCode = 1;
      });
  }
});

process.once("SIGINT", () => {
  closeServer()
    .then(() => { process.exitCode = 0; })
    .catch(error => {
      console.error(`[VITE SHUTDOWN ERROR] ${error.message}`);
      process.exitCode = 1;
    });
});
