const { validateRecord } = require("./validateInput");

function getFlexValues(record) {
    return [
        record.flex.f1,
        record.flex.f2,
        record.flex.f3,
        record.flex.f4,
        record.flex.f5
    ];
}

function getFlexPattern(record) {
    return getFlexValues(record).map(value => value ? "1" : "0").join("");
}

function createGesturePatternKey(flex, distanceState, mode) {
    if (typeof flex !== "string" || !/^[01]{5}$/.test(flex)) {
        throw new TypeError('Gesture flex must be a five-character binary string.');
    }
    if (!["LOW", "MID", "HIGH"].includes(distanceState)) {
        throw new TypeError('Gesture distance_state must be "LOW", "MID", or "HIGH".');
    }
    if (!Number.isInteger(mode) || (mode !== 0 && mode !== 1)) {
        throw new TypeError("Gesture mode must be either 0 or 1.");
    }

    return `${mode}|${flex}|${distanceState}`;
}

function createPatternKey(record) {
    const validation = validateRecord(record);

    if (!validation.valid) {
        throw new TypeError(validation.error);
    }

    return createGesturePatternKey(
        getFlexPattern(record),
        record.distance_state,
        record.mode
    );
}

function createFlexPattern(record) {
    const validation = validateRecord(record);

    if (!validation.valid) {
        throw new TypeError(validation.error);
    }

    return getFlexPattern(record);
}

module.exports = {
    createPatternKey,
    createFlexPattern,
    createGesturePatternKey
};
