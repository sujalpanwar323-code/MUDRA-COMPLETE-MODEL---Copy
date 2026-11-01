const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
    createCustomGestureManager
} = require("../src/customGestures");
const { customDefinitions } = require("../src/customGestures");
const { createSelectionStore } = require("../src/selectionStore");

async function createTemporarySelection(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-selection-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return path.join(directory, "selection.json");
}

function createManager(filePath) {
    return createCustomGestureManager({
        definitions: customDefinitions,
        selectionFilePath: filePath
    });
}

test("provides exactly five predefined custom slots without exposing patterns", () => {
    const manager = createManager(path.join(os.tmpdir(), "unused-selection.json"));
    const gestures = manager.getCustomGestures();

    assert.equal(gestures.length, 5);
    assert.deepEqual(Object.keys(gestures[0]).sort(), ["id", "name"]);
    assert.deepEqual(gestures.map(gesture => gesture.id), [
        "CUSTOM_1",
        "CUSTOM_2",
        "CUSTOM_3",
        "CUSTOM_4",
        "CUSTOM_5"
    ]);
});

test("selects each allowed ID and persists the selection across store instances", async t => {
    const filePath = await createTemporarySelection(t);

    for (const gesture of customDefinitions) {
        const manager = createManager(filePath);
        await manager.initialize();
        const result = await manager.selectCustomGesture(gesture.id);
        assert.deepEqual(result, {
            success: true,
            selectedGesture: gesture.id,
            name: gesture.name
        });

        const restartedManager = createManager(filePath);
        await restartedManager.initialize();
        assert.deepEqual(await restartedManager.getSelectedGesture(), {
            id: gesture.id,
            name: gesture.name
        });
    }
});

test("rejects invalid IDs without changing the saved selection", async t => {
    const filePath = await createTemporarySelection(t);
    const manager = createManager(filePath);
    await manager.initialize();
    await manager.selectCustomGesture("CUSTOM_2");

    const result = await manager.selectCustomGesture("CUSTOM_UNKNOWN");

    assert.equal(result.success, false);
    assert.equal(result.error.code, "INVALID_GESTURE_ID");
    assert.deepEqual(await manager.getSelectedGesture(), {
        id: "CUSTOM_2",
        name: customDefinitions.find(item => item.id === "CUSTOM_2").name
    });
});

test("initializes a missing selection file to no active custom gesture", async t => {
    const filePath = await createTemporarySelection(t);
    const manager = createManager(filePath);

    await manager.initialize();

    assert.equal(await manager.getSelectedGesture(), null);
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), {
        selectedGesture: null,
        assignments: []
    });
});

test("does not overwrite malformed selection storage", async t => {
    const filePath = await createTemporarySelection(t);
    await fs.writeFile(filePath, "{broken", "utf8");
    const manager = createManager(filePath);

    await assert.rejects(manager.initialize(), /malformed JSON/);
    assert.equal(await fs.readFile(filePath, "utf8"), "{broken");
});

test("rejects a persisted ID outside the predefined set", async t => {
    const filePath = await createTemporarySelection(t);
    await fs.writeFile(filePath, JSON.stringify({
        selectedGesture: "UNLISTED"
    }), "utf8");
    const manager = createManager(filePath);

    await assert.rejects(manager.initialize(), /unknown gesture ID/);
});

test("does not report success when the atomic write fails", async t => {
    const filePath = await createTemporarySelection(t);
    await fs.writeFile(filePath, JSON.stringify({
        selectedGesture: null
    }), "utf8");
    const store = createSelectionStore({
        filePath,
        fileSystem: {
            readFile: fs.readFile.bind(fs),
            writeFile: async () => {
                const error = new Error("simulated write failure");
                error.code = "EIO";
                throw error;
            },
            rename: fs.rename.bind(fs),
            unlink: fs.unlink.bind(fs)
        }
    });
    const manager = createCustomGestureManager({
        definitions: customDefinitions,
        store
    });

    await store.initialize(customDefinitions.map(gesture => gesture.id));
    await assert.rejects(
        manager.selectCustomGesture("CUSTOM_1"),
        /Could not persist/
    );
    assert.equal(await manager.getSelectedGesture(), null);
});

test("selection does not modify predefined gesture patterns", async t => {
    const filePath = await createTemporarySelection(t);
    const before = JSON.stringify(customDefinitions);
    const manager = createManager(filePath);

    await manager.initialize();
    await manager.selectCustomGesture("CUSTOM_3");

    assert.equal(JSON.stringify(customDefinitions), before);
});

test("automatically assigns the first free slot and rejects assignments when full", async t => {
    const filePath = await createTemporarySelection(t);
    const manager = createManager(filePath);
    await manager.initialize();

    const assigned = [];
    for (let index = 1; index <= 5; index += 1) {
        const result = await manager.addCustomGesture(
            `OWNER_LABEL_${index}`,
            index === 1 ? "Fixed sentence" : null
        );
        assert.equal(result.success, true);
        assert.equal(result.assignedGesture.id, `CUSTOM_${index}`);
        assigned.push(result.assignedGesture);
    }

    assert.equal(assigned[0].sentence, "Fixed sentence");
    const full = await manager.addCustomGesture("SIXTH_LABEL");
    assert.equal(full.success, false);
    assert.equal(full.error.code, "CUSTOM_GESTURE_SLOTS_FULL");
    assert.equal((await manager.getCustomGestureAssignments()).length, 5);
});

test("deletion frees a slot and the next add reuses the first free slot", async t => {
    const filePath = await createTemporarySelection(t);
    const manager = createManager(filePath);
    await manager.initialize();
    for (let index = 1; index <= 5; index += 1) {
        await manager.addCustomGesture(`LABEL_${index}`);
    }
    await manager.selectCustomGesture("CUSTOM_2");

    const deleted = await manager.deleteCustomGesture("CUSTOM_2");
    assert.deepEqual(deleted, {
        success: true,
        deletedGesture: "CUSTOM_2"
    });
    assert.equal(await manager.getSelectedGesture(), null);
    const next = await manager.addCustomGesture("REUSED_SLOT");
    assert.equal(next.assignedGesture.id, "CUSTOM_2");
    assert.equal(
        (await manager.getCustomGestureAssignments())
            .find(item => item.id === "CUSTOM_2").name,
        "REUSED_SLOT"
    );
    assert.equal(
        (await manager.deleteCustomGesture("CUSTOM_2")).success,
        true
    );
    assert.equal(
        (await manager.deleteCustomGesture("CUSTOM_2")).error.code,
        "CUSTOM_GESTURE_NOT_ASSIGNED"
    );
});

test("custom assignments and optional sentence survive manager restart", async t => {
    const filePath = await createTemporarySelection(t);
    const manager = createManager(filePath);
    await manager.initialize();
    await manager.addCustomGesture("PLEASE_HELP", "Please help me.");

    const restarted = createManager(filePath);
    await restarted.initialize();
    assert.deepEqual(await restarted.getCustomGestureAssignments(), [{
        id: "CUSTOM_1",
        name: "PLEASE_HELP",
        sentence: "Please help me."
    }]);
    const assignedPattern = (await restarted.getAssignedCustomPatterns())[0];
    assert.equal(assignedPattern.name, "PLEASE_HELP");
    assert.equal(assignedPattern.sentence, "Please help me.");
    assert.equal(assignedPattern.flex, customDefinitions[0].flex);
});

test("custom assignments require exactly five predefined slots", () => {
    assert.throws(
        () => createCustomGestureManager({
            definitions: customDefinitions.slice(0, 4)
        }),
        /exactly 5 entries/
    );
});
