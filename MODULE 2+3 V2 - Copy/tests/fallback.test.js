const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadJsonFile, validateFallbackLibrary } = require("../src/libraries");
const { createFallbackRecognizer } = require("../src/fallbackRecognizer");

const library = validateFallbackLibrary(loadJsonFile(
    path.join(__dirname, "..", "data", "fallbackLibrary.json"),
    "Fallback library"
));

function createRecord(flexPattern) {
    return {
        sequence_id: 1,
        mode: 0,
        flex: {
            f1: flexPattern[0] === "1",
            f2: flexPattern[1] === "1",
            f3: flexPattern[2] === "1",
            f4: flexPattern[3] === "1",
            f5: flexPattern[4] === "1"
        },
        distance_state: "LOW"
    };
}

test("generates and matches a five-bit flex-only pattern", () => {
    const matcher = createFallbackRecognizer(library);
    const entry = library[0];
    assert.equal(matcher.createFlexPattern(createRecord(entry.pattern)), entry.pattern);
    assert.equal(matcher.recognize(createRecord(entry.pattern)), entry.sentence);
});

test("each single flex bit changes only its own pattern position", () => {
    const matcher = createFallbackRecognizer(library);
    const baseline = createRecord("00000");

    for (let position = 0; position < 5; position += 1) {
        const pattern = `${"0".repeat(position)}1${"0".repeat(4 - position)}`;
        assert.equal(matcher.createFlexPattern(createRecord(pattern)), pattern);
        assert.equal(matcher.createFlexPattern(baseline), "00000");
    }
});

test("mode and distance changes do not affect fallback matching", () => {
    const matcher = createFallbackRecognizer(library);
    const entry = library[0];
    const record = createRecord(entry.pattern);
    const baseline = matcher.recognize(record);

    record.mode = 1;
    record.distance_state = "HIGH";

    assert.equal(matcher.createFlexPattern(record), entry.pattern);
    assert.equal(matcher.recognize(record), baseline);
});

test("rejects malformed sensor records passed directly to the matcher", () => {
    const matcher = createFallbackRecognizer(library);
    assert.throws(() => matcher.createFlexPattern(null), TypeError);
});

test("fallback library contains exactly 15 emergency entries", () => {
    assert.equal(library.length, 15);
});
