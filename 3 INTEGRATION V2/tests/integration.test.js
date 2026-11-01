const test = require("node:test");
const assert = require("node:assert/strict");
const { once: onceEvent } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const { createModule3 } = require("../src");
const standardGestures = require("../data/gestureLibrary.json").gestures;
const emergencyGestures = require("../data/fallbackLibrary.json").sentences;
const customGestures = require("../data/customGestures.json").gestures;

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

function recordFromGesture(gesture, sequence_id) {
    return {
        sequence_id,
        mode: gesture.mode,
        flex: {
            f1: gesture.flex[0] === "1",
            f2: gesture.flex[1] === "1",
            f3: gesture.flex[2] === "1",
            f4: gesture.flex[3] === "1",
            f5: gesture.flex[4] === "1"
        },
        distance_state: gesture.distance_state
    };
}

test("Module 2 function, selection, batch recognition, and output adapter work together", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-integration-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const module3 = createModule3({
        selectionFilePath: path.join(directory, "selection.json")
    });
    const gestures = module3.customGestureManager.getCustomGestures();

    const selection = await module3.selectCustomGesture("CUSTOM_2");
    assert.equal(selection.success, true);

    const customPattern = module3.customGestureManager.getCustomGestures()[1];
    const selectedDefinition = require("../data/customGestures.json")
        .gestures.find(gesture => gesture.id === customPattern.id);
    const standardDefinition = require("../data/gestureLibrary.json")
        .gestures[0];
    const records = [
        recordFromGesture(standardDefinition, 2),
        recordFromGesture(selectedDefinition, 1)
    ];
    const batch = await module3.processBatch(records);

    assert.deepEqual(batch.results.map(result => result.sequence_id), [1, 2]);
    assert.deepEqual(batch.keywords, [
        selectedDefinition.name,
        standardDefinition.keyword
    ]);

    const payload = module3.buildKeywordPayload(batch.results);
    assert.deepEqual(payload, {
        type: "recognized_keywords",
        keywords: batch.keywords
    });

    let sentPayload;
    const delivery = await module3.deliverPayload(
        payload,
        async value => { sentPayload = value; }
    );
    assert.deepEqual(sentPayload, payload);
    assert.equal(delivery.status, "send_accepted");

    const frontendResponse = await module3.handleFrontendMessage(
        JSON.stringify({ type: "GET_SELECTED_GESTURE" })
    );
    assert.equal(frontendResponse.selectedGesture, "CUSTOM_2");
    assert.equal(gestures.length, 5);
});

test("selection is restored by a new Module 3 instance", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-restart-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const selectionFilePath = path.join(directory, "selection.json");
    const first = createModule3({ selectionFilePath });
    await first.selectCustomGesture("CUSTOM_3");
    await first.addCustomGesture("PERSISTED_CUSTOM", "Metadata only.");

    const restarted = createModule3({ selectionFilePath });
    const selected = await restarted.getSelectedGesture();
    assert.equal(selected.id, "CUSTOM_3");
    const assignedPattern = customGestures[0];
    const recognition = await restarted.processModule2Message([{
        sequence_id: 44,
        mode: assignedPattern.mode,
        flex: assignedPattern.flex,
        distance_state: assignedPattern.distance_state
    }]);
    assert.equal(recognition.results[0].sequence_id, 44);
    assert.equal(recognition.results[0].keyword, "PERSISTED_CUSTOM");
    assert.equal(recognition.results[0].sentence, undefined);
});

test("configured frontend output publishes recognized batch keywords", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-ws-"));
    const module3 = createModule3({
        selectionFilePath: path.join(directory, "selection.json"),
        frontendWebSocket: {
            role: "server",
            host: "127.0.0.1",
            port: 0
        }
    });
    const address = await module3.startFrontendTransport();
    const frontend = new WebSocket(
        `ws://${address.host}:${address.port}`
    );
    t.after(async () => {
        frontend.close();
        await module3.closeFrontendTransport();
        await fs.rm(directory, { recursive: true, force: true });
    });
    await once(frontend, "open");

    const knownGesture = require("../data/gestureLibrary.json").gestures[0];
    const incoming = once(frontend, "message");
    const result = await module3.processBatch([
        recordFromGesture(knownGesture, 1)
    ]);

    assert.deepEqual(result.keywords, [knownGesture.keyword]);
    assert.equal(result.delivery.status, "send_accepted");
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        {
            type: "recognized_keywords",
            keywords: [knownGesture.keyword]
        }
    );
});

test("Module 2 direct array reaches recognition and the connected frontend", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-module2-ws-"));
    const module3 = createModule3({
        selectionFilePath: path.join(directory, "selection.json"),
        frontendWebSocket: {
            host: "127.0.0.1",
            port: 0
        }
    });

    const address = await module3.startWebSocketServer();
    const frontend = new WebSocket(
        `ws://${address.host}:${address.port}`
    );
    t.after(async () => {
        frontend.close();
        await module3.closeWebSocketServer();
        await fs.rm(directory, { recursive: true, force: true });
    });
    await once(frontend, "open");

    const message = [
        { sequence_id: 1, mode: 0, flex: "10000", distance_state: "LOW" },
        { sequence_id: 2, mode: 0, flex: "01010", distance_state: "MID" },
        { sequence_id: 3, mode: 1, flex: "00101", distance_state: "HIGH" },
        { sequence_id: 4, mode: 1, flex: "10100", distance_state: "MID" }
    ];
    const expectedKeyword = standardGestures.find(gesture =>
        gesture.mode === 1 &&
        gesture.flex === "00101" &&
        gesture.distance_state === "HIGH"
    ).keyword;
    const incoming = once(frontend, "message");
    const result = await module3.processModule2Message(message);

    assert.equal(result.success, true);
    assert.deepEqual(result.results.map(item => item.sequence_id), [1, 2, 3, 4]);
    assert.equal(result.results[2].sequence_id, 3);
    assert.equal(result.results[2].keyword, expectedKeyword);
    assert.deepEqual(result.keywords, [expectedKeyword]);
    assert.equal(result.delivery.status, "send_accepted");
    assert.deepEqual(JSON.parse((await incoming).toString()), {
        type: "recognized_keywords",
        keywords: [expectedKeyword]
    });
});

test("frontend controls custom assignment and exclusive emergency recognition over WebSocket", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-control-ws-"));
    const module3 = createModule3({
        selectionFilePath: path.join(directory, "selection.json"),
        frontendWebSocket: {
            host: "127.0.0.1",
            port: 0
        }
    });
    const address = await module3.startWebSocketServer();
    const frontend = new WebSocket(
        `ws://${address.host}:${address.port}`
    );
    t.after(async () => {
        frontend.close();
        await module3.closeWebSocketServer();
        await fs.rm(directory, { recursive: true, force: true });
    });
    await once(frontend, "open");

    let responseEvent = once(frontend, "message");
    frontend.send(JSON.stringify({
        type: "ADD_CUSTOM_GESTURE",
        name: "MY_LABEL",
        sentence: "Metadata only."
    }));
    assert.deepEqual(
        JSON.parse((await responseEvent).toString()),
        {
            type: "CUSTOM_GESTURE_ADD_RESULT",
            success: true,
            assignedGesture: {
                id: "CUSTOM_1",
                name: "MY_LABEL",
                sentence: "Metadata only."
            }
        }
    );

    let incoming = once(frontend, "message");
    const assignedPattern = customGestures[0];
    const customResult = await module3.processModule2Message([{
        sequence_id: 500,
        mode: assignedPattern.mode,
        flex: assignedPattern.flex,
        distance_state: assignedPattern.distance_state
    }]);
    assert.equal(customResult.results[0].source, "custom");
    assert.equal(customResult.results[0].keyword, "MY_LABEL");
    assert.equal(customResult.results[0].sentence, undefined);
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        {
            type: "recognized_keywords",
            keywords: ["MY_LABEL"]
        }
    );

    responseEvent = once(frontend, "message");
    frontend.send(JSON.stringify({
        type: "DELETE_CUSTOM_GESTURE",
        id: "CUSTOM_1"
    }));
    assert.equal(
        JSON.parse((await responseEvent).toString()).success,
        true
    );
    const afterDelete = await module3.processModule2Message([{
        sequence_id: 504,
        mode: assignedPattern.mode,
        flex: assignedPattern.flex,
        distance_state: assignedPattern.distance_state
    }]);
    assert.equal(afterDelete.results[0].status, "unknown");
    assert.deepEqual(afterDelete.keywords, []);

    responseEvent = once(frontend, "message");
    frontend.send(JSON.stringify({ type: "ACTIVATE_EMERGENCY_MODE" }));
    assert.deepEqual(
        JSON.parse((await responseEvent).toString()),
        { type: "EMERGENCY_MODE_STATUS", active: true }
    );

    const emergency = emergencyGestures[0];
    incoming = once(frontend, "message");
    const recognized = await module3.processModule2Message([{
        sequence_id: 501,
        mode: 1,
        flex: emergency.pattern,
        distance_state: "HIGH"
    }]);
    assert.equal(recognized.results[0].sequence_id, 501);
    assert.equal(recognized.results[0].source, "fallback");
    assert.equal(recognized.results[0].keyword, emergency.sentence);
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        {
            type: "EMERGENCY_RESULT",
            mode: "EMERGENCY",
            trigger: "frontend",
            status: "MATCH",
            sequence_id: 501,
            sentence: emergency.sentence
        }
    );

    incoming = once(frontend, "message");
    const noMatch = await module3.processModule2Message([{
        sequence_id: 502,
        mode: 0,
        flex: "00000",
        distance_state: "LOW"
    }]);
    assert.equal(noMatch.results[0].status, "no_match");
    assert.equal(noMatch.results[0].keyword, "NO_MATCH");
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        {
            type: "EMERGENCY_RESULT",
            mode: "EMERGENCY",
            trigger: "frontend",
            status: "NO_MATCH",
            sequence_id: 502
        }
    );

    responseEvent = once(frontend, "message");
    frontend.send(JSON.stringify({ type: "DEACTIVATE_EMERGENCY_MODE" }));
    assert.deepEqual(
        JSON.parse((await responseEvent).toString()),
        { type: "EMERGENCY_MODE_STATUS", active: false }
    );

    const standard = standardGestures[0];
    incoming = once(frontend, "message");
    const normal = await module3.processModule2Message([{
        sequence_id: 503,
        mode: standard.mode,
        flex: standard.flex,
        distance_state: standard.distance_state
    }]);
    assert.equal(normal.results[0].source, "standard");
    assert.equal(normal.results[0].keyword, standard.keyword);
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        {
            type: "recognized_keywords",
            keywords: [standard.keyword]
        }
    );

    responseEvent = once(frontend, "message");
    frontend.send(JSON.stringify({ type: "UNKNOWN_CONTROL" }));
    assert.equal(
        JSON.parse((await responseEvent).toString()).code,
        "UNKNOWN_OPERATION"
    );
    responseEvent = once(frontend, "message");
    frontend.send("{");
    assert.equal(
        JSON.parse((await responseEvent).toString()).code,
        "INVALID_JSON"
    );
    assert.equal(customGestures.length, 5);
});

test("Module 3 defaults to a local server without starting it during creation", async t => {
    const module3 = createModule3();
    assert.equal(module3.frontendTransport.role, "server");
    assert.equal(module3.frontendTransport.host, "127.0.0.1");
    assert.equal(module3.frontendTransport.port, 8080);
    assert.equal(module3.frontendTransport.started, false);

    const knownGesture = require("../data/gestureLibrary.json").gestures[0];
    const result = await module3.recognizeRecord(
        recordFromGesture(knownGesture, 1)
    );
    assert.equal(result.status, "recognized");
    assert.equal(result.delivery.status, "disconnected");
});

test("Module 3 rejects a client-role override", () => {
    assert.throws(() => createModule3({
        frontendWebSocket: {
            role: "client",
            url: "ws://127.0.0.1:8080"
        }
    }), /role must be "server"/);
    assert.throws(() => createModule3({
        frontendWebSocket: "invalid"
    }), /must be a configuration object/);
});

test("individual recognition sends its recognized keyword to the frontend", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-single-ws-"));
    const module3 = createModule3({
        selectionFilePath: path.join(directory, "selection.json"),
        frontendWebSocket: {
            host: "127.0.0.1",
            port: 0
        }
    });
    const address = await module3.startWebSocketServer();
    const frontend = new WebSocket(
        `ws://${address.host}:${address.port}`
    );
    t.after(async () => {
        frontend.close();
        await module3.closeWebSocketServer();
        await fs.rm(directory, { recursive: true, force: true });
    });
    await once(frontend, "open");

    const knownGesture = require("../data/gestureLibrary.json").gestures[0];
    const incoming = once(frontend, "message");
    const result = await module3.recognizeRecord(
        recordFromGesture(knownGesture, 1)
    );

    assert.equal(result.delivery.status, "send_accepted");
    assert.deepEqual(
        JSON.parse((await incoming).toString()),
        {
            type: "recognized_keywords",
            keywords: [knownGesture.keyword]
        }
    );
});

test("recognition succeeds when the configured frontend is disconnected", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-offline-"));
    const module3 = createModule3({
        selectionFilePath: path.join(directory, "selection.json"),
        frontendWebSocket: {
            role: "server",
            host: "127.0.0.1",
            port: 0
        }
    });
    await module3.startFrontendTransport();
    t.after(async () => {
        await module3.closeFrontendTransport();
        await fs.rm(directory, { recursive: true, force: true });
    });

    const knownGesture = require("../data/gestureLibrary.json").gestures[0];
    const result = await module3.processBatch([
        recordFromGesture(knownGesture, 1)
    ]);

    assert.equal(result.success, true);
    assert.deepEqual(result.keywords, [knownGesture.keyword]);
    assert.equal(result.delivery.status, "disconnected");
});


test("Module 3 WebSocket server delivers initial CONNECTION_ESTABLISHED handshake to frontend on connect", async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-handshake-"));
    const module3 = createModule3({
        selectionFilePath: path.join(directory, "selection.json"),
        frontendWebSocket: {
            host: "127.0.0.1",
            port: 0
        }
    });
    const address = await module3.startWebSocketServer();
    const frontend = new WebSocket(`ws://${address.host}:${address.port}`);
    t.after(async () => {
        frontend.close();
        await module3.closeWebSocketServer();
        await fs.rm(directory, { recursive: true, force: true });
    });

    const firstMessage = await new Promise((resolve, reject) => {
        frontend.once("message", resolve);
        frontend.once("error", reject);
    });

    assert.deepEqual(
        JSON.parse(firstMessage.toString()),
        { type: "CONNECTION_ESTABLISHED" }
    );
});
