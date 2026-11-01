const test = require("node:test");
const assert = require("node:assert/strict");

const { validateRecord } = require("../src/validateInput.js");

const FLEX_FIELDS = ["f1", "f2", "f3", "f4", "f5"];

function createValidRecord() {
    return {
        sequence_id: 1,
        mode: 0,
        flex: {
            f1: true,
            f2: false,
            f3: true,
            f4: false,
            f5: true
        },
        distance_state: "MID"
    };
}

function assertInvalidRecord(record) {
    const result = validateRecord(record);

    assert.equal(result.valid, false);
    assert.equal(typeof result.error, "string");
    assert.notEqual(result.error.length, 0);
}

test("accepts a complete valid Module 2 record", () => {
    assert.deepEqual(validateRecord(createValidRecord()), {
        valid: true,
        error: null
    });
});

test("does not modify the input record", () => {
    const record = createValidRecord();
    const original = structuredClone(record);

    validateRecord(record);

    assert.deepEqual(record, original);
});

test("rejects null, arrays, strings, and numbers instead of a record", () => {
    for (const value of [null, [], [createValidRecord()], "record", 42]) {
        assertInvalidRecord(value);
    }
});

test("rejects a record with no sequence_id", () => {
    const record = createValidRecord();
    delete record.sequence_id;
    assertInvalidRecord(record);
});

test("rejects string, Boolean, null, and decimal sequence IDs", () => {
    for (const sequenceId of ["1", true, false, null, 1.5]) {
        assertInvalidRecord({
            ...createValidRecord(),
            sequence_id: sequenceId
        });
    }
});

test("rejects missing and invalid mode values", () => {
    const missingMode = createValidRecord();
    delete missingMode.mode;
    assertInvalidRecord(missingMode);

    for (const mode of [-1, 2, "1", true, null]) {
        assertInvalidRecord({
            ...createValidRecord(),
            mode
        });
    }
});

test("rejects missing and invalid flex groups", () => {
    const missingFlex = createValidRecord();
    delete missingFlex.flex;
    assertInvalidRecord(missingFlex);

    for (const invalidFlex of [null, [], "flex", 1, true, undefined]) {
        assertInvalidRecord({
            ...createValidRecord(),
            flex: invalidFlex
        });
    }
});

test("rejects every missing required flex field", () => {
    for (const field of FLEX_FIELDS) {
        const record = createValidRecord();
        delete record.flex[field];
        assertInvalidRecord(record);
    }
});

test("rejects non-Boolean values for every flex field", () => {
    for (const field of FLEX_FIELDS) {
        for (const invalidValue of ["true", 0, 1, null]) {
            const record = createValidRecord();
            record.flex[field] = invalidValue;
            assertInvalidRecord(record);
        }
    }
});

test("accepts both true and false for every flex field", () => {
    for (const field of FLEX_FIELDS) {
        for (const value of [true, false]) {
            const record = createValidRecord();
            record.flex[field] = value;

            assert.deepEqual(validateRecord(record), {
                valid: true,
                error: null
            });
        }
    }
});

test("rejects missing and invalid distance states", () => {
    const missingDistance = createValidRecord();
    delete missingDistance.distance_state;
    assertInvalidRecord(missingDistance);

    for (const distanceState of ["LOWER", "mid", "", null, 1]) {
        assertInvalidRecord({
            ...createValidRecord(),
            distance_state: distanceState
        });
    }
});

test("accepts each allowed distance state", () => {
    for (const distance_state of ["LOW", "MID", "HIGH"]) {
        assert.deepEqual(validateRecord({
            ...createValidRecord(),
            distance_state
        }), {
            valid: true,
            error: null
        });
    }
});

test("accepts integer sequence IDs and extra properties", () => {
    for (const sequence_id of [0, -1, 100]) {
        const record = createValidRecord();
        record.sequence_id = sequence_id;
        record.extra = "allowed";
        record.flex.extraFlexReading = 123;

        assert.deepEqual(validateRecord(record), {
            valid: true,
            error: null
        });
    }
});
