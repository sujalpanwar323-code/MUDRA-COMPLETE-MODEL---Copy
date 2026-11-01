const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createCustomGestureManager } = require("../src/customGestures");
const { handleFrontendMessage } = require("../src/frontendMessageHandler");

async function createManager(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-frontend-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const manager = createCustomGestureManager({
        selectionFilePath: path.join(directory, "selection.json")
    });
    await manager.initialize();
    return manager;
}

test("lists predefined gestures without exposing patterns", async t => {
    const manager = await createManager(t);
    const response = await handleFrontendMessage(
        JSON.stringify({ type: "GET_CUSTOM_GESTURES" }),
        manager
    );

    assert.equal(response.type, "CUSTOM_GESTURES");
    assert.equal(response.gestures.length, 5);
    assert.ok(response.gestures.every(gesture =>
        Object.keys(gesture).sort().join(",") === "id,name"
    ));
});

test("adds and deletes custom assignments without accepting sensor patterns", async t => {
    const manager = await createManager(t);
    const added = await handleFrontendMessage(JSON.stringify({
        type: "ADD_CUSTOM_GESTURE",
        name: "MY_LABEL",
        sentence: "A fixed sentence."
    }), manager);
    assert.deepEqual(added, {
        type: "CUSTOM_GESTURE_ADD_RESULT",
        success: true,
        assignedGesture: {
            id: "CUSTOM_1",
            name: "MY_LABEL",
            sentence: "A fixed sentence."
        }
    });

    const invalid = await handleFrontendMessage(JSON.stringify({
        type: "ADD_CUSTOM_GESTURE",
        name: "INVALID",
        flex: "00000"
    }), manager);
    assert.equal(invalid.code, "INVALID_MESSAGE");

    const deleted = await handleFrontendMessage(JSON.stringify({
        type: "DELETE_CUSTOM_GESTURE",
        id: "CUSTOM_1"
    }), manager);
    assert.equal(deleted.success, true);
    assert.equal(deleted.deletedGesture, "CUSTOM_1");
});

test("activates and deactivates emergency mode with validated control messages", async t => {
    const manager = await createManager(t);
    let active = false;
    const control = {
        isActive: () => active,
        setActive: value => { active = value; }
    };

    const activated = await handleFrontendMessage(JSON.stringify({
        type: "ACTIVATE_EMERGENCY_MODE"
    }), manager, control);
    assert.deepEqual(activated, {
        type: "EMERGENCY_MODE_STATUS",
        active: true
    });
    assert.equal((await handleFrontendMessage(JSON.stringify({
        type: "GET_EMERGENCY_MODE"
    }), manager, control)).active, true);

    const deactivated = await handleFrontendMessage(JSON.stringify({
        type: "DEACTIVATE_EMERGENCY_MODE"
    }), manager, control);
    assert.deepEqual(deactivated, {
        type: "EMERGENCY_MODE_STATUS",
        active: false
    });
    assert.equal(active, false);
    const invalid = await handleFrontendMessage(JSON.stringify({
        type: "ACTIVATE_EMERGENCY_MODE",
        active: false
    }), manager, control);
    assert.equal(invalid.code, "INVALID_MESSAGE");
    assert.equal(active, false);
});

test("gets an empty and then selected gesture", async t => {
    const manager = await createManager(t);
    const empty = await handleFrontendMessage(
        JSON.stringify({ type: "GET_SELECTED_GESTURE" }),
        manager
    );
    assert.equal(empty.selectedGesture, null);

    await handleFrontendMessage(JSON.stringify({
        type: "CUSTOM_GESTURE_SELECTION",
        selectedGesture: "CUSTOM_2"
    }), manager);
    const selected = await handleFrontendMessage(
        JSON.stringify({ type: "GET_SELECTED_GESTURE" }),
        manager
    );
    assert.equal(selected.selectedGesture, "CUSTOM_2");
});

test("selects only predefined IDs and rejects invalid IDs", async t => {
    const manager = await createManager(t);
    const response = await handleFrontendMessage(JSON.stringify({
        type: "CUSTOM_GESTURE_SELECTION",
        selectedGesture: "NOT_ALLOWED"
    }), manager);

    assert.equal(response.success, false);
    assert.equal(response.error.code, "INVALID_GESTURE_ID");
    assert.equal((await manager.getSelectedGesture()), null);
});

test("returns errors for malformed JSON, missing fields, and unknown operations", async t => {
    const manager = await createManager(t);
    assert.equal(
        (await handleFrontendMessage("{", manager)).code,
        "INVALID_JSON"
    );
    assert.equal(
        (await handleFrontendMessage("{}", manager)).code,
        "INVALID_MESSAGE"
    );
    assert.equal(
        (await handleFrontendMessage(
            JSON.stringify({ type: "UNSUPPORTED" }),
            manager
        )).code,
        "UNKNOWN_OPERATION"
    );
    assert.equal(
        (await handleFrontendMessage(JSON.stringify({
            type: "CUSTOM_GESTURE_SELECTION",
            selectedGesture: 1
        }), manager)).code,
        "INVALID_MESSAGE"
    );
});

test("accepts WebSocket Buffer frames", async t => {
    const manager = await createManager(t);
    const response = await handleFrontendMessage(
        Buffer.from('{"type":"GET_CUSTOM_GESTURES"}'),
        manager
    );
    assert.equal(response.type, "CUSTOM_GESTURES");
});
