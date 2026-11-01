function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
}

function failure(code, message, index) {
    return {
        valid: false,
        error: {
            code,
            message,
            ...(index === undefined ? {} : { index })
        }
    };
}

function adaptModule2Message(message) {
    let gestures = message;

    if (Buffer.isBuffer(gestures)) {
        gestures = gestures.toString("utf8");
    }
    if (typeof gestures === "string") {
        try {
            gestures = JSON.parse(gestures);
        } catch {
            return failure("INVALID_JSON", "Input must contain valid JSON.");
        }
    }

    if (!Array.isArray(gestures)) {
        return failure(
            "INVALID_BATCH",
            "Module 2 input must be an array of gesture objects."
        );
    }

    const records = [];
    const sequenceIds = new Set();
    for (const [index, gesture] of gestures.entries()) {
        if (!isObject(gesture)) {
            return failure(
                "INVALID_GESTURE",
                "Each gesture must be an object.",
                index
            );
        }
        if (!Object.prototype.hasOwnProperty.call(gesture, "sequence_id")) {
            return failure(
                "MISSING_SEQUENCE_ID",
                '"sequence_id" is required.',
                index
            );
        }
        if (!Number.isSafeInteger(gesture.sequence_id)) {
            return failure(
                "INVALID_SEQUENCE_ID",
                '"sequence_id" must be a safe integer.',
                index
            );
        }
        if (sequenceIds.has(gesture.sequence_id)) {
            return failure(
                "DUPLICATE_SEQUENCE_ID",
                `Batch contains duplicate sequence_id ${gesture.sequence_id}.`,
                index
            );
        }
        sequenceIds.add(gesture.sequence_id);
        if (!Number.isInteger(gesture.mode) ||
            (gesture.mode !== 0 && gesture.mode !== 1)) {
            return failure(
                "INVALID_GESTURE",
                '"mode" must be either 0 or 1.',
                index
            );
        }
        if (typeof gesture.flex !== "string" ||
            !/^[01]{5}$/.test(gesture.flex)) {
            return failure(
                "INVALID_GESTURE",
                '"flex" must contain exactly five binary characters.',
                index
            );
        }
        if (!["LOW", "MID", "HIGH"].includes(gesture.distance_state)) {
            return failure(
                "INVALID_GESTURE",
                '"distance_state" must be "LOW", "MID", or "HIGH".',
                index
            );
        }

        records.push({
            sequence_id: gesture.sequence_id,
            mode: gesture.mode,
            flex: {
                f1: gesture.flex[0] === "1",
                f2: gesture.flex[1] === "1",
                f3: gesture.flex[2] === "1",
                f4: gesture.flex[3] === "1",
                f5: gesture.flex[4] === "1"
            },
            distance_state: gesture.distance_state
        });
    }

    return {
        valid: true,
        records
    };
}

module.exports = {
    adaptModule2Message
};
