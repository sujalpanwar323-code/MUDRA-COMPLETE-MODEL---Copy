const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadJsonFile, validateStandardLibrary, validateCustomLibrary,
    validateFallbackLibrary } = require("../src/libraries");
const { createRecognitionEngine } = require("../src/recognizer");
const { customDefinitions } = require("../src/customGestures");

const dataDirectory = path.join(__dirname, "..", "data");
const standardLibrary = validateStandardLibrary(loadJsonFile(
    path.join(dataDirectory, "gestureLibrary.json"), "Standard library"
));
const customLibrary = validateCustomLibrary(loadJsonFile(
    path.join(dataDirectory, "customGestures.json"), "Custom library"
));
const fallbackLibrary = validateFallbackLibrary(loadJsonFile(
    path.join(dataDirectory, "fallbackLibrary.json"), "Fallback library"
));

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

function createEngine() {
    const manager = {
        initialize: async () => {},
        getSelectedCustomPattern: async () => null
    };
    return createRecognitionEngine({
        standardLibrary,
        customLibrary,
        customGestureManager: manager,
        fallbackLibrary
    });
}

test("sorts already-ascending records and retains recognized keywords", async () => {
    const entries = standardLibrary.slice(0, 3);
    const result = await createEngine().processBatch(entries.map(
        (entry, index) => recordFromGesture(entry, index + 1)
    ));

    assert.equal(result.success, true);
    assert.deepEqual(result.keywords, entries.map(entry => entry.keyword));
});

test("sorts descending and shuffled records without mutating input", async () => {
    const entries = standardLibrary.slice(0, 4);
    const records = [
        recordFromGesture(entries[2], 30),
        recordFromGesture(entries[0], 10),
        recordFromGesture(entries[3], 40),
        recordFromGesture(entries[1], 20)
    ];
    const before = structuredClone(records);
    const result = await createEngine().processBatch(records);

    assert.deepEqual(result.keywords, entries.map(entry => entry.keyword));
    assert.deepEqual(records, before);
});

test("omits unknown results from keyword output but retains per-record results", async () => {
    const known = standardLibrary[0];
    const result = await createEngine().processBatch([
        recordFromGesture({
            flex: "11111",
            mode: 0,
            distance_state: "HIGH"
        }, 2),
        recordFromGesture(known, 1)
    ]);

    assert.deepEqual(result.keywords, [known.keyword]);
    assert.deepEqual(result.results.map(item => item.status), [
        "recognized",
        "unknown"
    ]);
});

test("returns an empty result for an empty batch", async () => {
    assert.deepEqual(await createEngine().processBatch([]), {
        success: true,
        status: "processed",
        results: [],
        keywords: []
    });
});

test("rejects non-array batch input", async () => {
    const result = await createEngine().processBatch({});
    assert.equal(result.success, false);
    assert.equal(result.error.code, "INVALID_BATCH");
    assert.deepEqual(result.results, []);
});

test("rejects duplicate sequence IDs without returning partial results", async () => {
    const entry = standardLibrary[0];
    const result = await createEngine().processBatch([
        recordFromGesture(entry, 1),
        recordFromGesture(standardLibrary[1], 1)
    ]);

    assert.equal(result.success, false);
    assert.equal(result.error.code, "DUPLICATE_SEQUENCE_ID");
    assert.deepEqual(result.results, []);
    assert.deepEqual(result.keywords, []);
});

test("rejects an invalid batch record before processing any record", async () => {
    const first = recordFromGesture(standardLibrary[0], 1);
    const invalid = recordFromGesture(standardLibrary[1], 2);
    delete invalid.distance_state;
    const records = [first, invalid];
    const before = structuredClone(records);
    const result = await createEngine().processBatch(records);

    assert.equal(result.success, false);
    assert.equal(result.error.code, "INVALID_SENSOR_RECORD");
    assert.deepEqual(result.results, []);
    assert.deepEqual(records, before);
});

test("accepts multiple IDs in ascending output order even with negative values", async () => {
    const entries = standardLibrary.slice(0, 2);
    const result = await createEngine().processBatch([
        recordFromGesture(entries[1], 0),
        recordFromGesture(entries[0], -1)
    ]);
    assert.deepEqual(result.keywords, entries.map(entry => entry.keyword));
});
