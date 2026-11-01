const fs = require("node:fs");

function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
}

function requireEntryArray(data, property, description) {
    if (!isObject(data) || !Array.isArray(data[property])) {
        throw new Error(`${description} must contain a "${property}" array.`);
    }

    return data[property];
}

function validateEntries(entries, options) {
    const {
        description,
        patternLength,
        textField
    } = options;
    const ids = new Set();
    const patterns = new Set();

    for (const [index, entry] of entries.entries()) {
        const label = `${description} entry ${index + 1}`;

        if (!isObject(entry)) {
            throw new Error(`${label} must be an object.`);
        }
        if (typeof entry.id !== "string" || entry.id.trim() === "") {
            throw new Error(`${label} must have a nonempty string id.`);
        }
        if (ids.has(entry.id)) {
            throw new Error(`${description} contains duplicate id "${entry.id}".`);
        }
        ids.add(entry.id);

        if (typeof entry.pattern !== "string" ||
            !new RegExp(`^[01]{${patternLength}}$`).test(entry.pattern)) {
            throw new Error(
                `${label} pattern must contain exactly ${patternLength} binary characters.`
            );
        }
        if (patterns.has(entry.pattern)) {
            throw new Error(
                `${description} contains duplicate pattern "${entry.pattern}".`
            );
        }
        patterns.add(entry.pattern);

        if (typeof entry[textField] !== "string" ||
            entry[textField].trim() === "") {
            throw new Error(`${label} must have a nonempty ${textField}.`);
        }
    }

    return entries;
}

function validateGestureEntries(entries, options) {
    const { description, textField, uniqueText = false } = options;
    const ids = new Set();
    const patterns = new Set();
    const textValues = new Set();

    for (const [index, entry] of entries.entries()) {
        const label = `${description} entry ${index + 1}`;
        if (!isObject(entry)) {
            throw new Error(`${label} must be an object.`);
        }
        if (typeof entry.id !== "string" || entry.id.trim() === "") {
            throw new Error(`${label} must have a nonempty string id.`);
        }
        if (ids.has(entry.id)) {
            throw new Error(`${description} contains duplicate id "${entry.id}".`);
        }
        ids.add(entry.id);

        if (typeof entry.flex !== "string" || !/^[01]{5}$/.test(entry.flex)) {
            throw new Error(`${label} flex must contain exactly five binary characters.`);
        }
        if (!Number.isInteger(entry.mode) || (entry.mode !== 0 && entry.mode !== 1)) {
            throw new Error(`${label} mode must be either 0 or 1.`);
        }
        if (!["LOW", "MID", "HIGH"].includes(entry.distance_state)) {
            throw new Error(`${label} distance_state must be "LOW", "MID", or "HIGH".`);
        }

        const pattern = `${entry.mode}|${entry.flex}|${entry.distance_state}`;
        if (patterns.has(pattern)) {
            throw new Error(`${description} contains duplicate pattern "${pattern}".`);
        }
        patterns.add(pattern);

        if (typeof entry[textField] !== "string" ||
            entry[textField].trim() === "") {
            throw new Error(`${label} must have a nonempty ${textField}.`);
        }
        if (uniqueText && textValues.has(entry[textField])) {
            throw new Error(
                `${description} contains duplicate ${textField} "${entry[textField]}".`
            );
        }
        textValues.add(entry[textField]);
    }

    return entries;
}

function validateStandardLibrary(data, expectedCount = undefined) {
    if (!isObject(data) ||
        data.status !== "DEMONSTRATION_ONLY_UNCALIBRATED") {
        throw new Error(
            "Standard library must be marked DEMONSTRATION_ONLY_UNCALIBRATED."
        );
    }

    const entries = requireEntryArray(data, "gestures", "Standard library");
    if (entries.length === 0 || entries.length > 192) {
        throw new Error("Standard library must contain between 1 and 192 gestures.");
    }
    if (expectedCount !== undefined && entries.length !== expectedCount) {
        throw new Error(
            `Standard library must contain exactly ${expectedCount} entries; found ${entries.length}.`
        );
    }

    return validateGestureEntries(entries, {
        description: "Standard library",
        textField: "keyword",
        uniqueText: true
    });
}

function validateCustomLibrary(data, expectedCount = undefined) {
    if (!isObject(data) ||
        data.status !== "DEMONSTRATION_ONLY_UNCALIBRATED") {
        throw new Error(
            "Custom library must be marked DEMONSTRATION_ONLY_UNCALIBRATED."
        );
    }

    const entries = requireEntryArray(data, "gestures", "Custom library");
    if (expectedCount !== undefined && expectedCount !== 5) {
        throw new Error("Custom library must define exactly five reserved slots.");
    }
    if (entries.length !== 5) {
        throw new Error(
            `Custom library must contain exactly 5 entries; found ${entries.length}.`
        );
    }

    return validateGestureEntries(entries, {
        description: "Custom library",
        textField: "name",
    });
}

function validateFallbackLibrary(data, expectedCount = undefined) {
    if (!isObject(data) ||
        data.status !== "DEMONSTRATION_ONLY_UNCALIBRATED") {
        throw new Error(
            "Fallback library must be marked DEMONSTRATION_ONLY_UNCALIBRATED."
        );
    }

    const entries = requireEntryArray(data, "sentences", "Fallback library");
    if (expectedCount !== undefined && expectedCount !== 15) {
        throw new Error("Fallback library must contain exactly 15 entries.");
    }
    if (entries.length !== 15) {
        throw new Error(
            `Fallback library must contain exactly 15 entries; found ${entries.length}.`
        );
    }

    return validateEntries(entries, {
        description: "Fallback library",
        patternLength: 5,
        textField: "sentence"
    });
}

function loadJsonFile(filePath, description) {
    let text;

    try {
        text = fs.readFileSync(filePath, "utf8");
    } catch (error) {
        throw new Error(`Could not read ${description} at "${filePath}".`, {
            cause: error
        });
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        throw new Error(`${description} contains malformed JSON.`, {
            cause: error
        });
    }
}

module.exports = {
    validateStandardLibrary,
    validateCustomLibrary,
    validateFallbackLibrary,
    loadJsonFile
};
