const test = require("node:test");
const assert = require("node:assert/strict");
const { once: onceEvent } = require("node:events");
const WebSocket = require("ws");
const { createWebSocketAdapter, createWebSocketServer } = require("../src/webSocketAdapter");

function once(target, event) {
    if (event === "message") {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                target.off("message", handler);
                reject(new Error("Timeout waiting for message"));
            }, 5000);
            function handler(data) {
                try {
                    const parsed = JSON.parse(data.toString());
                    // Skip automatic connection handshake confirmation unless explicitly handled
                    if (parsed && parsed.type === "CONNECTION_ESTABLISHED") {
                        return;
                    }
                } catch {}
                clearTimeout(timeout);
                target.off("message", handler);
                resolve(data);
            }
            target.on("message", handler);
        });
    }
    return onceEvent(target, event, {
        signal: AbortSignal.timeout(5000)
    }).then(args => args[0]);
}

function keywordMessage(keywords) {
    return {
        type: "recognized_keywords",
        keywords
    };
}

test("server sends initial CONNECTION_ESTABLISHED payload upon client connection", async t => {
    const adapter = createWebSocketAdapter({
        role: "server",
        host: "127.0.0.1",
        port: 0
    });
    const address = await adapter.start();
    const client = new WebSocket(`ws://${address.host}:${address.port}`);
    t.after(async () => {
        client.close();
        await adapter.close();
    });

    const firstMessage = await new Promise((resolve, reject) => {
        client.once("message", resolve);
        client.once("error", reject);
    });

    assert.deepEqual(
        JSON.parse(firstMessage.toString()),
        { type: "CONNECTION_ESTABLISHED" }
    );
});

test("server sends serialized recognized keywords and closes gracefully", async t => {
    const adapter = createWebSocketAdapter({
        role: "server",
        host: "127.0.0.1",
        port: 0
    });
    const address = await adapter.start();
    const client = new WebSocket(
        `ws://${address.host}:${address.port}`
    );
    t.after(async () => {
        client.close();
        await adapter.close();
    });
    await once(client, "open");

    const incoming = once(client, "message");
    const result = adapter.send(keywordMessage(["HELLO", "WORLD"]));
    assert.equal(result.status, "send_accepted");
    assert.equal(result.recipients, 1);
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        keywordMessage(["HELLO", "WORLD"])
    );
});

test("server reports its actual endpoint and starts only once", async t => {
    const adapter = createWebSocketAdapter({
        role: "server",
        host: "127.0.0.1",
        port: 0
    });
    t.after(() => adapter.close());

    assert.equal(adapter.started, false);
    const address = await adapter.start();
    assert.equal(adapter.started, true);
    assert.equal(address.role, "server");
    assert.equal(address.host, "127.0.0.1");
    assert.ok(Number.isInteger(address.port));
    assert.notEqual(address.port, 0);
    assert.deepEqual(await adapter.start(), address);

    await adapter.close();
    await assert.rejects(adapter.start(), /already been closed/);
});

test("server does not crash or send when the frontend disconnects", async t => {
    const adapter = createWebSocketAdapter({
        role: "server",
        host: "127.0.0.1",
        port: 0
    });
    const address = await adapter.start();
    const client = new WebSocket(
        `ws://${address.host}:${address.port}`
    );
    const clients = [client];
    t.after(async () => {
        for (const connectedClient of clients) {
            connectedClient.close();
        }
        await adapter.close();
    });
    await once(client, "open");

    const disconnected = once(client, "close");
    client.close();
    await disconnected;

    assert.deepEqual(
        adapter.send(keywordMessage(["HELLO"])),
        {
            success: false,
            status: "disconnected",
            message: "No frontend WebSocket connection is available."
        }
    );

    const reconnectedClient = new WebSocket(
        `ws://${address.host}:${address.port}`
    );
    clients.push(reconnectedClient);
    await once(reconnectedClient, "open");
    const incoming = once(reconnectedClient, "message");
    assert.equal(
        adapter.send(keywordMessage(["RECONNECTED"])).status,
        "send_accepted"
    );
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        keywordMessage(["RECONNECTED"])
    );
});

test("client mode sends keywords to a configured frontend WebSocket server", async t => {
    const peer = new WebSocket.Server({
        host: "127.0.0.1",
        port: 0
    });
    await once(peer, "listening");
    const address = peer.address();
    const clientSocket = once(peer, "connection");
    const adapter = createWebSocketAdapter({
        role: "client",
        url: `ws://127.0.0.1:${address.port}`
    });
    t.after(async () => {
        await adapter.close();
        await new Promise(resolve => peer.close(resolve));
    });

    await adapter.start();
    const connectedClient = await clientSocket;
    const incoming = once(connectedClient, "message");
    assert.equal(
        adapter.send(keywordMessage(["FIRST", "SECOND"])).status,
        "send_accepted"
    );
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        keywordMessage(["FIRST", "SECOND"])
    );
});

test("reports connection failures without crashing the caller", async t => {
    const adapter = createWebSocketAdapter({
        role: "client",
        url: "ws://127.0.0.1:1"
    });
    let reportedError;
    adapter.on("transportError", error => { reportedError = error; });
    t.after(() => adapter.close());

    await assert.rejects(adapter.start());
    assert.ok(reportedError instanceof Error);
    assert.equal(adapter.send(keywordMessage(["HELLO"])).status, "disconnected");
});

test("requires explicit role-specific connection configuration", () => {
    assert.throws(() => createWebSocketAdapter({}), TypeError);
    assert.throws(() => createWebSocketAdapter({
        role: "server",
        host: "127.0.0.1"
    }), TypeError);
    assert.throws(() => createWebSocketAdapter({
        role: "client",
        url: "http://localhost"
    }), TypeError);
});
