const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
    loadJsonFile,
    validateStandardLibrary,
    validateCustomLibrary,
    validateFallbackLibrary
} = require("../src/libraries");
const { createRecognitionEngine } = require("../src/recognizer");
const { customDefinitions } = require("../src/customGestures");

const dataDirectory = path.join(__dirname, "..", "data");
const standardLibrary = validateStandardLibrary(loadJsonFile(
    path.join(dataDirectory, "gestureLibrary.json"),
    "Standard library"
));
const customLibrary = validateCustomLibrary(loadJsonFile(
    path.join(dataDirectory, "customGestures.json"),
    "Custom library"
));
const fallbackLibrary = validateFallbackLibrary(loadJsonFile(
    path.join(dataDirectory, "fallbackLibrary.json"),
    "Fallback library"
));

function createMemoryManager(selectedGesture = null) {
    return {
        initialize: async () => {},
        getSelectedCustomPattern: async () => {
            if (selectedGesture === null) return null;
            return customLibrary.find(gesture => gesture.id === selectedGesture);
        }
    };
}

function createRecord(flexPattern, sequenceId = 1, mode = 0, distanceState = "LOW") {
    return {
        sequence_id: sequenceId,
        mode,
        flex: {
            f1: flexPattern[0] === "1",
            f2: flexPattern[1] === "1",
            f3: flexPattern[2] === "1",
            f4: flexPattern[3] === "1",
            f5: flexPattern[4] === "1"
        },
        distance_state: distanceState
    };
}

function createEngine(selectedGesture = null, standard = standardLibrary) {
    return createRecognitionEngine({
        standardLibrary: standard,
        customLibrary,
        customGestureManager: createMemoryManager(selectedGesture),
        fallbackLibrary
    });
}

test("recognizes a configured standard demonstration pattern", async () => {
    const entry = standardLibrary[0];
    const result = await createEngine().recognizeRecord(
        createRecord(entry.flex, 1, entry.mode, entry.distance_state)
    );

    assert.deepEqual(result, {
        sequence_id: 1,
        status: "recognized",
        source: "standard",
        keyword: entry.keyword,
        pattern: `${entry.mode}|${entry.flex}|${entry.distance_state}`
    });
});

test("every standard library mapping is reachable through the recognition engine", async () => {
    const records = standardLibrary.map((entry, index) =>
        createRecord(
            entry.flex,
            index + 1,
            entry.mode,
            entry.distance_state
        )
    );
    const result = await createEngine().processBatch(records);

    assert.equal(result.success, true);
    assert.equal(result.results.length, standardLibrary.length);
    assert.deepEqual(
        result.results.map(item => item.sequence_id),
        standardLibrary.map((_, index) => index + 1)
    );
    assert.deepEqual(
        result.results.map(item => item.keyword),
        standardLibrary.map(entry => entry.keyword)
    );
    assert.ok(result.results.every(item =>
        item.status === "recognized" && item.source === "standard"
    ));
});

test("returns unknown with no keyword for unmapped patterns", async () => {
    const result = await createEngine().recognizeRecord(
        createRecord("11111")
    );

    assert.equal(result.status, "unknown");
    assert.equal(result.keyword, null);
});

test("recognizes standard gestures using the new mode and distance-aware schema", async () => {
    const engine = createRecognitionEngine({
        standardLibrary: [{
            id: "MODE_0",
            flex: "01010",
            distance_state: "MID",
            mode: 0,
            keyword: "HELLO"
        }, {
            id: "MODE_1",
            flex: "01010",
            distance_state: "MID",
            mode: 1,
            keyword: "THANK YOU"
        }],
        customLibrary,
        customGestureManager: createMemoryManager(null),
        fallbackLibrary
    });
    const first = {
        sequence_id: 7,
        mode: 0,
        flex: { f1: false, f2: true, f3: false, f4: true, f5: false },
        distance_state: "MID"
    };
    const second = {
        ...first,
        sequence_id: 8,
        mode: 1
    };

    const firstResult = await engine.recognizeRecord(first);
    const secondResult = await engine.recognizeRecord(second);

    assert.equal(firstResult.status, "recognized");
    assert.equal(secondResult.status, "recognized");
    assert.notEqual(firstResult.keyword, secondResult.keyword);
    assert.equal(firstResult.keyword, "HELLO");
    assert.equal(secondResult.keyword, "THANK YOU");
    assert.equal(firstResult.pattern, "0|01010|MID");
    assert.equal(secondResult.pattern, "1|01010|MID");

    const wrongDistance = await engine.recognizeRecord({
        ...first,
        sequence_id: 9,
        distance_state: "HIGH"
    });
    const wrongFlex = await engine.recognizeRecord({
        ...first,
        sequence_id: 10,
        flex: { ...first.flex, f1: true }
    });
    assert.equal(wrongDistance.status, "unknown");
    assert.equal(wrongFlex.status, "unknown");
});

test("returns structured invalid-record results", async () => {
    const result = await createEngine().recognizeRecord(null);

    assert.equal(result.status, "invalid_record");
    assert.equal(result.keyword, null);
    assert.equal(result.pattern, null);
    assert.equal(result.error.code, "INVALID_SENSOR_RECORD");
});

test("does not recognize the all-straight pattern as a standard gesture", async () => {
    const record = createRecord("00000");
    const result = await createEngine().recognizeRecord(record);

    assert.equal(result.status, "unknown");
    assert.equal(result.keyword, null);
});

test("selected custom pattern is recognized when it does not conflict with standard", async () => {
    const custom = customLibrary[0];
    const engine = createEngine(custom.id);
    const result = await engine.recognizeRecord(createRecord(
        custom.flex,
        1,
        custom.mode,
        custom.distance_state
    ));

    assert.equal(result.status, "recognized");
    assert.equal(result.source, "custom");
    assert.equal(result.keyword, custom.name);
});

test("unselected custom patterns do not receive custom priority", async () => {
    const unselected = customLibrary[0];
    const result = await createEngine("CUSTOM_2")
        .recognizeRecord(createRecord(
            unselected.flex,
            1,
            unselected.mode,
            unselected.distance_state
        ));

    assert.equal(result.status, "unknown");
    assert.equal(result.source, null);
});

test("rejects custom patterns that conflict with a standard library pattern", () => {
    const conflictingStandard = [{
        id: "STANDARD_CONFLICT",
        flex: customLibrary[0].flex,
        mode: customLibrary[0].mode,
        distance_state: customLibrary[0].distance_state,
        keyword: "STANDARD_KEYWORD"
    }];

    assert.throws(
        () => createEngine(null, conflictingStandard),
        /conflicts with standard pattern/
    );
});

test("assigned custom patterns use the assigned name and keep sentence metadata", async () => {
    const assigned = {
        ...customLibrary[0],
        name: "MY_CUSTOM_KEYWORD",
        sentence: "Optional fixed sentence."
    };
    const manager = {
        initialize: async () => {},
        getAssignedCustomPatterns: async () => [assigned],
        getSelectedCustomPattern: async () => null
    };
    const engine = createRecognitionEngine({
        standardLibrary,
        customLibrary,
        customGestureManager: manager,
        fallbackLibrary
    });
    const result = await engine.recognizeRecord(createRecord(
        assigned.flex,
        72,
        assigned.mode,
        assigned.distance_state
    ));

    assert.equal(result.sequence_id, 72);
    assert.equal(result.status, "recognized");
    assert.equal(result.source, "custom");
    assert.equal(result.keyword, "MY_CUSTOM_KEYWORD");
    assert.equal(result.sentence, undefined);
});

test("fallback is opt-in and remains independent from standard matching", async () => {
    const engine = createEngine(null, [standardLibrary[0]]);
    const fallbackEntry = fallbackLibrary.find(entry => entry.pattern === "01111");
    const record = createRecord(fallbackEntry.pattern, 1, 0, "LOW");

    assert.equal((await engine.recognizeRecord(record)).status, "unknown");
    const activated = await engine.recognizeRecord(record, {
        fallbackEnabled: true
    });
    assert.equal(activated.source, "fallback");
    assert.equal(activated.keyword, fallbackEntry.sentence);

    const standardEntry = standardLibrary[0];
    const standardMatch = await engine.recognizeRecord(createRecord(
        standardEntry.flex,
        2,
        standardEntry.mode,
        standardEntry.distance_state
    ), {
        fallbackEnabled: true
    });
    assert.equal(standardMatch.status, "recognized");
    assert.equal(standardMatch.source, "standard");
});

test("emergency mode exactly matches all 15 flex patterns and preserves sequence IDs", async () => {
    const bypassManager = {
        initialize: async () => {
            throw new Error("Custom recognition must be bypassed.");
        },
        getAssignedCustomPatterns: async () => {
            throw new Error("Custom recognition must be bypassed.");
        },
        getSelectedCustomPattern: async () => {
            throw new Error("Custom recognition must be bypassed.");
        }
    };
    const engine = createRecognitionEngine({
        standardLibrary,
        customLibrary,
        customGestureManager: bypassManager,
        fallbackLibrary
    });
    const records = fallbackLibrary.map((entry, index) =>
        createRecord(
            entry.pattern,
            index + 10,
            index % 2,
            ["LOW", "MID", "HIGH"][index % 3]
        )
    );
    const result = await engine.processBatch(records, {
        emergencyMode: true
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.results.map(item => item.sequence_id),
        records.map((_, index) => index + 10));
    assert.deepEqual(result.results.map(item => item.keyword),
        fallbackLibrary.map(entry => entry.sentence));
    assert.ok(result.results.every(item =>
        item.status === "recognized" &&
        item.source === "fallback" &&
        /^[01]{5}$/.test(item.pattern)
    ));
});

test("emergency matching ignores mode and distance and returns NO_MATCH for unmapped flex", async () => {
    const engine = createEngine();
    const entry = fallbackLibrary[0];
    const first = await engine.recognizeRecord(
        createRecord(entry.pattern, 90, 0, "LOW"),
        { emergencyMode: true }
    );
    const second = await engine.recognizeRecord(
        createRecord(entry.pattern, 91, 1, "HIGH"),
        { emergencyMode: true }
    );
    assert.equal(first.keyword, entry.sentence);
    assert.equal(second.keyword, entry.sentence);
    assert.equal(first.pattern, entry.pattern);
    assert.equal(second.pattern, entry.pattern);
    assert.equal(first.sequence_id, 90);
    assert.equal(second.sequence_id, 91);

    const noMatch = await engine.processBatch([
        createRecord("00000", 92, 0, "MID"),
        createRecord("11111", 93, 1, "HIGH")
    ], { emergencyMode: true });
    assert.ok(noMatch.results.every(result =>
        result.status === "no_match" &&
        result.source === "fallback" &&
        result.keyword === "NO_MATCH"
    ));
    assert.deepEqual(noMatch.keywords, ["NO_MATCH", "NO_MATCH"]);
});
