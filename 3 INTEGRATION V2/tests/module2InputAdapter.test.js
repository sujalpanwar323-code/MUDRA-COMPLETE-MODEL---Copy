const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createModule3 } = require("../src");
const { adaptModule2Message } = require("../src/module2InputAdapter");
const standardGestures = require("../data/gestureLibrary.json").gestures;

function keywordFor(mode, flex, distance_state) {
    const gesture = standardGestures.find(entry =>
        entry.mode === mode &&
        entry.flex === flex &&
        entry.distance_state === distance_state
    );
    assert.ok(gesture, `Expected a configured mapping for ${mode}|${flex}|${distance_state}`);
    return gesture.keyword;
}

function module2Gestures() {
    return [
        { sequence_id: 1, mode: 0, flex: "10000", distance_state: "LOW" },
        { sequence_id: 2, mode: 0, flex: "01010", distance_state: "MID" },
        { sequence_id: 3, mode: 1, flex: "00101", distance_state: "HIGH" },
        { sequence_id: 4, mode: 1, flex: "10100", distance_state: "MID" }
    ];
}

async function createModule(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mudra-input-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    return createModule3({
        selectionFilePath: path.join(directory, "selection.json"),
        frontendWebSocket: { host: "127.0.0.1", port: 0 }
    });
}

test("accepts the direct Module 2 array and preserves supplied sequence IDs", async t => {
    const module3 = await createModule(t);
    const message = module2Gestures();
    const before = structuredClone(message);
    const result = await module3.processModule2Message(message);

    assert.equal(result.success, true);
    assert.deepEqual(result.results.map(item => item.sequence_id), [1, 2, 3, 4]);
    assert.deepEqual(message, before);
    assert.equal(result.results[2].status, "recognized");
    assert.equal(result.results[2].sequence_id, 3);
    const expectedKeyword = keywordFor(1, "00101", "HIGH");
    assert.equal(result.results[2].keyword, expectedKeyword);
    assert.deepEqual(result.keywords, [expectedKeyword]);
    assert.equal(result.delivery.status, "disconnected");
});

test("accepts JSON strings and Buffer input", async t => {
    const module3 = await createModule(t);
    const message = module2Gestures();

    const stringResult = await module3.processModule2Message(
        JSON.stringify(message)
    );
    const bufferResult = await module3.processModule2Message(
        Buffer.from(JSON.stringify(message))
    );

    assert.deepEqual(stringResult.results.map(item => item.sequence_id), [1, 2, 3, 4]);
    assert.deepEqual(bufferResult.results.map(item => item.sequence_id), [1, 2, 3, 4]);
    const expectedKeyword = keywordFor(1, "00101", "HIGH");
    assert.deepEqual(stringResult.keywords, [expectedKeyword]);
    assert.deepEqual(bufferResult.keywords, [expectedKeyword]);
});

test("keeps each supplied ID associated with its gesture when sorting results", async t => {
    const module3 = await createModule(t);
    const expectedThankYou = keywordFor(0, "00000", "MID");
    const expectedWhy = keywordFor(1, "00101", "HIGH");
    const result = await module3.processModule2Message([
        { sequence_id: 8, mode: 1, flex: "00101", distance_state: "HIGH" },
        { sequence_id: 2, mode: 0, flex: "00000", distance_state: "MID" }
    ]);

    assert.deepEqual(result.results.map(item => ({
        sequence_id: item.sequence_id,
        keyword: item.keyword
    })), [
        { sequence_id: 2, keyword: expectedThankYou },
        { sequence_id: 8, keyword: expectedWhy }
    ]);
    assert.deepEqual(result.keywords, [
        expectedThankYou,
        expectedWhy
    ]);
});

test("converts flex string positions to the internal Boolean record", () => {
    const result = adaptModule2Message([{
        sequence_id: 41,
        mode: 1,
        flex: "01010",
        distance_state: "MID"
    }]);

    assert.deepEqual(result, {
        valid: true,
        records: [{
            sequence_id: 41,
            mode: 1,
            flex: {
                f1: false,
                f2: true,
                f3: false,
                f4: true,
                f5: false
            },
            distance_state: "MID"
        }]
    });
});

test("accepts an empty direct array as an empty successful batch", async t => {
    const module3 = await createModule(t);
    const result = await module3.processModule2Message([]);

    assert.deepEqual(result, {
        success: true,
        status: "processed",
        results: [],
        keywords: []
    });
});

test("rejects malformed JSON, non-array input, and invalid gestures", async t => {
    const module3 = await createModule(t);
    const invalidMode = {
        sequence_id: 1,
        mode: 2,
        flex: "00000",
        distance_state: "LOW"
    };
    const invalidFlex = {
        sequence_id: 1,
        mode: 0,
        flex: "0000",
        distance_state: "LOW"
    };
    const invalidDistance = {
        sequence_id: 1,
        mode: 0,
        flex: "00000",
        distance_state: "NEAR"
    };

    for (const [input, code] of [
        ["{", "INVALID_JSON"],
        [null, "INVALID_BATCH"],
        [{ gestures: [] }, "INVALID_BATCH"],
        [[null], "INVALID_GESTURE"],
        [[invalidMode], "INVALID_GESTURE"],
        [[invalidFlex], "INVALID_GESTURE"],
        [[invalidDistance], "INVALID_GESTURE"]
    ]) {
        const result = await module3.processModule2Message(input);
        assert.equal(result.success, false);
        assert.equal(result.status, "invalid_message");
        assert.equal(result.error.code, code);
        assert.deepEqual(result.results, []);
        assert.deepEqual(result.keywords, []);
    }
});

test("rejects missing, invalid, unsafe, and duplicate sequence IDs", async t => {
    const module3 = await createModule(t);
    const gesture = {
        mode: 0,
        flex: "00000",
        distance_state: "MID"
    };
    const missing = [{ ...gesture }];
    const invalid = [{ ...gesture, sequence_id: "1" }];
    const unsafe = [{
        ...gesture,
        sequence_id: Number.MAX_SAFE_INTEGER + 1
    }];
    const duplicate = [
        { ...gesture, sequence_id: 7 },
        { ...gesture, sequence_id: 7 }
    ];

    assert.equal((await module3.processModule2Message(missing)).error.code,
        "MISSING_SEQUENCE_ID");
    assert.equal((await module3.processModule2Message(invalid)).error.code,
        "INVALID_SEQUENCE_ID");
    assert.equal((await module3.processModule2Message(unsafe)).error.code,
        "INVALID_SEQUENCE_ID");
    assert.equal((await module3.processModule2Message(duplicate)).error.code,
        "DUPLICATE_SEQUENCE_ID");
});
