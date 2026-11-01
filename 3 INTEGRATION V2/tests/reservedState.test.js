const test = require("node:test");
const assert = require("node:assert/strict");
const { isReservedState } = require("../src/reservedState");

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

test("new-schema records are not treated as legacy reserved states", () => {
    assert.equal(isReservedState(createRecord()), false);
});

test("rejects malformed records when checking reserved state", () => {
    assert.throws(() => isReservedState([]), TypeError);
});
