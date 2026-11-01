const test = require("node:test");
const assert = require("node:assert/strict");
const { createPatternKey, createFlexPattern } = require("../src/patternKeys");

function createRecord() {
    return {
        sequence_id: 1,
        mode: 0,
        flex: {
            f1: false,
            f2: false,
            f3: false,
            f4: false,
            f5: false
        },
        distance_state: "LOW"
    };
}

test("generates a mode, flex, and distance pattern key", () => {
    assert.equal(createPatternKey(createRecord()), "0|00000|LOW");
});

test("maps each flex field to its exact position", () => {
    for (let position = 0; position < 5; position += 1) {
        const record = createRecord();
        record.flex[`f${position + 1}`] = true;
        const expected = `0|${"0".repeat(position)}1${"0".repeat(4 - position)}|LOW`;
        assert.equal(createPatternKey(record), expected);
    }
});

test("mode and distance state each contribute to the pattern key", () => {
    const record = createRecord();
    record.mode = 1;
    record.distance_state = "HIGH";
    assert.equal(createPatternKey(record), "1|00000|HIGH");
});

test("flex-only keys remain independent of mode and distance", () => {
    const first = createRecord();
    const second = {
        ...createRecord(),
        mode: 1,
        distance_state: "MID"
    };
    first.flex.f2 = true;
    second.flex.f2 = true;

    assert.equal(createFlexPattern(first), "01000");
    assert.equal(createFlexPattern(second), "01000");
});

test("does not include sequence_id or depend on object property order", () => {
    const record = createRecord();
    record.flex.f1 = true;
    const reordered = {
        distance_state: "LOW",
        flex: {
            f5: false,
            f4: false,
            f3: false,
            f2: false,
            f1: true
        },
        mode: 0,
        sequence_id: 999
    };

    assert.equal(createPatternKey(reordered), "0|10000|LOW");
    assert.equal(createPatternKey(reordered), createPatternKey(record));
});

test("rejects malformed records without mutating valid input", () => {
    const record = createRecord();
    const before = structuredClone(record);
    assert.throws(() => createPatternKey(null), TypeError);
    assert.equal(createPatternKey(record), "0|00000|LOW");
    assert.deepEqual(record, before);
});
