const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
    validateStandardLibrary,
    validateCustomLibrary,
    validateFallbackLibrary,
    loadJsonFile
} = require("../src/libraries");

const dataPath = path.join(__dirname, "..", "data");
const standard = loadJsonFile(
    path.join(dataPath, "gestureLibrary.json"),
    "Standard gesture library"
);
const custom = loadJsonFile(
    path.join(dataPath, "customGestures.json"),
    "Custom gesture library"
);
const fallback = loadJsonFile(
    path.join(dataPath, "fallbackLibrary.json"),
    "Fallback library"
);

test("standard library has 50 unique demonstration mappings across both modes", () => {
    const entries = validateStandardLibrary(standard);
    assert.equal(standard.status, "DEMONSTRATION_ONLY_UNCALIBRATED");
    assert.equal(
        standard.mappingStatus,
        "KEYWORD_LABELS_UPDATED_PATTERN_MAPPINGS_UNCALIBRATED"
    );
    assert.equal(entries.length, 50);
    assert.equal(new Set(entries.map(entry => entry.id)).size, 50);
    assert.ok(entries.every((entry, index) =>
        entry.id === `GESTURE_${String(index + 1).padStart(3, "0")}`
    ));
    assert.equal(new Set(entries.map(entry => entry.keyword)).size, 50);
    assert.ok(entries.every(entry =>
        /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/.test(entry.keyword)
    ));
    assert.deepEqual(
        Object.keys(entries[0]).sort(),
        ["distance_state", "flex", "id", "keyword", "mode"]
    );
    assert.ok(entries.every(entry =>
        /^[01]{5}$/.test(entry.flex) &&
        [0, 1].includes(entry.mode) &&
        ["LOW", "MID", "HIGH"].includes(entry.distance_state)
    ));
    assert.deepEqual(new Set(entries.map(entry => entry.mode)), new Set([0, 1]));
    assert.equal(entries[0].flex, entries[3].flex);
    assert.equal(entries[0].distance_state, entries[3].distance_state);
    assert.notEqual(entries[0].mode, entries[3].mode);
    assert.equal(new Set(entries.map(entry =>
        `${entry.mode}|${entry.flex}|${entry.distance_state}`
    )).size, 50);
});

test("custom library has five unique, uncalibrated slot patterns", () => {
    const entries = validateCustomLibrary(custom);
    assert.equal(custom.status, "DEMONSTRATION_ONLY_UNCALIBRATED");
    assert.equal(custom.mappingStatus, "PENDING_HARDWARE_VALIDATION");
    assert.equal(entries.length, 5);
    assert.equal(new Set(entries.map(entry => entry.id)).size, 5);
    assert.equal(new Set(entries.map(entry =>
        `${entry.mode}|${entry.flex}|${entry.distance_state}`
    )).size, 5);
    assert.ok(entries.every(entry =>
        /^[01]{5}$/.test(entry.flex) &&
        [0, 1].includes(entry.mode) &&
        ["LOW", "MID", "HIGH"].includes(entry.distance_state)
    ));
    const standardPatterns = new Set(standard.gestures.map(entry =>
        `${entry.mode}|${entry.flex}|${entry.distance_state}`
    ));
    assert.ok(entries.every(entry =>
        !standardPatterns.has(
            `${entry.mode}|${entry.flex}|${entry.distance_state}`
        )
    ));
    assert.throws(
        () => validateCustomLibrary(custom, 3),
        /exactly five reserved slots/
    );
    const duplicatePattern = structuredClone(custom);
    duplicatePattern.gestures[4] = {
        ...duplicatePattern.gestures[0],
        id: "CUSTOM_5"
    };
    assert.throws(
        () => validateCustomLibrary(duplicatePattern),
        /duplicate pattern/
    );
});

test("fallback library has exactly 15 unique five-bit sentence mappings", () => {
    const entries = validateFallbackLibrary(fallback);
    assert.equal(entries.length, 15);
    assert.equal(new Set(entries.map(entry => entry.id)).size, 15);
    assert.equal(new Set(entries.map(entry => entry.pattern)).size, 15);
    assert.ok(entries.every(entry => /^[01]{5}$/.test(entry.pattern)));
});

test("rejects a standard library with an unexpected top-level structure", () => {
    assert.throws(
        () => validateStandardLibrary({ gestures: [] }),
        /marked DEMONSTRATION_ONLY_UNCALIBRATED/
    );
});

test("rejects duplicate IDs, duplicate complete patterns, and malformed patterns", () => {
    const makeStandard = gestures => ({
        status: "DEMONSTRATION_ONLY_UNCALIBRATED",
        gestures
    });
    const entry = {
        id: "A",
        mode: 0,
        flex: "10000",
        distance_state: "LOW",
        keyword: "EXAMPLE"
    };

    assert.throws(
        () => validateStandardLibrary(makeStandard([entry, { ...entry }]), 2),
        /duplicate id/
    );
    assert.throws(
        () => validateStandardLibrary(makeStandard([
            entry,
            { ...entry, id: "B" }
        ]), 2),
        /duplicate pattern "0\|10000\|LOW"/
    );
    assert.doesNotThrow(() => validateStandardLibrary(makeStandard([
        entry,
        { ...entry, id: "B", mode: 1, keyword: "OTHER" }
    ]), 2));
    assert.throws(
        () => validateStandardLibrary(makeStandard([{
            ...entry,
            flex: "101"
        }]), 1),
        /five binary characters/
    );
    assert.throws(
        () => validateStandardLibrary(makeStandard([{
            ...entry,
            mode: 2
        }]), 1),
        /mode must be either 0 or 1/
    );
    assert.throws(
        () => validateStandardLibrary(makeStandard([{
            ...entry,
            distance_state: "NEAR"
        }]), 1),
        /distance_state/
    );
    assert.throws(
        () => validateStandardLibrary(makeStandard([
            entry,
            { ...entry, id: "B", mode: 1 }
        ]), 2),
        /duplicate keyword/
    );
});

test("rejects standard library counts other than 50", () => {
    assert.throws(
        () => validateStandardLibrary({
            status: standard.status,
            gestures: standard.gestures.slice(0, 49)
        }, 50),
        /exactly 50/
    );
    assert.throws(
        () => validateStandardLibrary({
            status: standard.status,
            gestures: [...standard.gestures, standard.gestures[0]]
        }, 50),
        /exactly 50/
    );
});

test("rejects fallback patterns shorter than five binary bits", () => {
    const smallLibrary = {
        status: "DEMONSTRATION_ONLY_UNCALIBRATED",
        sentences: Array.from({ length: 15 }, (_, index) => ({
            id: `F${index}`,
            pattern: index === 0 ? "101" : index.toString(2).padStart(5, "0"),
            sentence: `Demo ${index}`
        }))
    };
    assert.throws(
        () => validateFallbackLibrary(smallLibrary),
        /exactly 5 binary characters/
    );
});

test("rejects fallback libraries with other than exactly 15 mappings", () => {
    assert.throws(
        () => validateFallbackLibrary({
            status: fallback.status,
            sentences: fallback.sentences.slice(0, 14)
        }),
        /exactly 15/
    );
    assert.throws(
        () => validateFallbackLibrary({
            status: fallback.status,
            sentences: [
                ...fallback.sentences,
                { ...fallback.sentences[0], id: "FALLBACK_EXTRA" }
            ]
        }),
        /exactly 15/
    );
    assert.throws(
        () => validateFallbackLibrary(fallback, 14),
        /exactly 15/
    );
});

test("reports missing and malformed JSON library files", () => {
    assert.throws(() => loadJsonFile("missing-library.json", "Test library"), /Could not read/);
});
