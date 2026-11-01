const FLEX_FIELDS = ["f1", "f2", "f3", "f4", "f5"];
const VALID_DISTANCE_STATES = new Set(["LOW", "MID", "HIGH"]);

function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
}

function failure(message) {
    return {
        valid: false,
        error: message
    };
}

function validateRecord(record) {
    if (!isObject(record)) {
        return failure("Record must be a non-null object, not an array.");
    }

    if (!Object.prototype.hasOwnProperty.call(record, "sequence_id")) {
        return failure('"sequence_id" is required.');
    }
    if (!Number.isSafeInteger(record.sequence_id)) {
        return failure('"sequence_id" must be a safe integer.');
    }

    if (!Object.prototype.hasOwnProperty.call(record, "mode")) {
        return failure('"mode" is required.');
    }
    if (!Number.isInteger(record.mode) || (record.mode !== 0 && record.mode !== 1)) {
        return failure('"mode" must be either 0 or 1.');
    }

    if (!isObject(record.flex)) {
        return failure('"flex" must be an object.');
    }
    for (const field of FLEX_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(record.flex, field)) {
            return failure(`"flex.${field}" is required.`);
        }
        if (typeof record.flex[field] !== "boolean") {
            return failure(`"flex.${field}" must be a Boolean.`);
        }
    }

    if (!Object.prototype.hasOwnProperty.call(record, "distance_state")) {
        return failure('"distance_state" is required.');
    }
    if (typeof record.distance_state !== "string" ||
        !VALID_DISTANCE_STATES.has(record.distance_state)) {
        return failure('"distance_state" must be one of "LOW", "MID", or "HIGH".');
    }

    return {
        valid: true,
        error: null
    };
}

module.exports = {
    validateRecord
};
