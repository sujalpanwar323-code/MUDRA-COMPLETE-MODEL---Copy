const { validateRecord } = require("./validateInput");
const {
    createPatternKey,
    createGesturePatternKey
} = require("./patternKeys");
const { isReservedState } = require("./reservedState");
const {
    validateStandardLibrary,
    validateCustomLibrary,
    validateFallbackLibrary
} = require("./libraries");
const { createFallbackRecognizer } = require("./fallbackRecognizer");

function entryPattern(entry) {
    if (entry && typeof entry.flex === "string") {
        return createGesturePatternKey(
            entry.flex,
            entry.distance_state,
            entry.mode
        );
    }
    return null;
}

function createRecognitionEngine(options) {
    const standardData = Array.isArray(options.standardLibrary)
        ? {
            status: "DEMONSTRATION_ONLY_UNCALIBRATED",
            gestures: options.standardLibrary
        }
        : options.standardLibrary;
    const customData = Array.isArray(options.customLibrary)
        ? {
            status: "DEMONSTRATION_ONLY_UNCALIBRATED",
            gestures: options.customLibrary
        }
        : options.customLibrary;
    const fallbackData = Array.isArray(options.fallbackLibrary)
        ? {
            status: "DEMONSTRATION_ONLY_UNCALIBRATED",
            sentences: options.fallbackLibrary
        }
        : options.fallbackLibrary;
    const standardEntries = validateStandardLibrary(
        standardData,
        options.expectedStandardCount
    );
    const customEntries = validateCustomLibrary(
        customData,
        options.expectedCustomCount
    );
    const standardPatterns = new Set(standardEntries.map(entryPattern));
    for (const entry of customEntries) {
        const pattern = entryPattern(entry);
        if (standardPatterns.has(pattern)) {
            throw new Error(
                `Custom gesture "${entry.id}" conflicts with standard pattern "${pattern}".`
            );
        }
    }
    const standardByPattern = new Map(
        standardEntries.map(entry => [entryPattern(entry), entry.keyword])
    );
    const customById = new Map(
        customEntries.map(entry => [entry.id, entry])
    );
    const fallbackRecognizer = options.fallbackLibrary
        ? createFallbackRecognizer(validateFallbackLibrary(fallbackData))
        : null;
    let initialization;

    async function initialize() {
        if (!initialization) {
            initialization = options.customGestureManager.initialize();
        }

        try {
            await initialization;
        } catch (error) {
            initialization = undefined;
            throw error;
        }
    }

    async function recognizeRecord(record, recognitionOptions = {}) {
        const validation = validateRecord(record);

        if (!validation.valid) {
            return {
                sequence_id: record &&
                    Number.isSafeInteger(record.sequence_id)
                    ? record.sequence_id
                    : null,
                status: "invalid_record",
                source: null,
                keyword: null,
                pattern: null,
                error: {
                    code: "INVALID_SENSOR_RECORD",
                    message: validation.error
                }
            };
        }

        const pattern = createPatternKey(record);
        if (recognitionOptions.emergencyMode === true ||
            record.emergency_mode === true) {
            const sentence = fallbackRecognizer
                ? fallbackRecognizer.recognize(record)
                : null;
            return {
                sequence_id: record.sequence_id,
                mode: record.mode,
                emergency_mode: record.emergency_mode === true,
                emergency: true,
                status: sentence === null ? "no_match" : "recognized",
                source: "fallback",
                keyword: sentence === null ? "NO_MATCH" : sentence,
                pattern: fallbackRecognizer
                    ? fallbackRecognizer.createFlexPattern(record)
                    : pattern
            };
        }

        if (isReservedState(record)) {
            return {
                sequence_id: record.sequence_id,
                status: "reserved",
                source: null,
                keyword: null,
                pattern
            };
        }

        await initialize();
        const assignedPatterns = typeof options.customGestureManager
            .getAssignedCustomPatterns === "function"
            ? await options.customGestureManager.getAssignedCustomPatterns()
            : [];
        const assigned = assignedPatterns.find(entry =>
            entryPattern(entry) === pattern
        );
        if (assigned) {
            return {
                sequence_id: record.sequence_id,
                status: "recognized",
                source: "custom",
                keyword: assigned.name,
                pattern
            };
        }

        const selected = await options.customGestureManager
            .getSelectedCustomPattern();
        const selectedPattern = selected ? entryPattern(selected) : null;
        if (selectedPattern && selectedPattern === pattern) {
            return {
                sequence_id: record.sequence_id,
                status: "recognized",
                source: "custom",
                keyword: selected.name,
                pattern
            };
        }

        const standard = standardByPattern.get(pattern);
        if (standard !== undefined) {
            return {
                sequence_id: record.sequence_id,
                status: "recognized",
                source: "standard",
                keyword: standard,
                pattern
            };
        }

        if (recognitionOptions.fallbackEnabled === true &&
            fallbackRecognizer) {
            const sentence = fallbackRecognizer.recognize(record);
            if (sentence) {
                return {
                    sequence_id: record.sequence_id,
                    status: "recognized",
                    source: "fallback",
                    keyword: sentence,
                    pattern
                };
            }
        }

        return {
            sequence_id: record.sequence_id,
            status: "unknown",
            source: null,
            keyword: null,
            pattern
        };
    }

    async function processBatch(records, recognitionOptions = {}) {
        if (!Array.isArray(records)) {
            return {
                success: false,
                status: "invalid_batch",
                error: {
                    code: "INVALID_BATCH",
                    message: "Batch input must be an array of sensor records."
                },
                results: [],
                keywords: []
            };
        }

        const seenSequenceIds = new Set();
        for (const [index, record] of records.entries()) {
            const validation = validateRecord(record);
            if (!validation.valid) {
                return {
                    success: false,
                    status: "invalid_batch",
                    error: {
                        code: "INVALID_SENSOR_RECORD",
                        index,
                        message: validation.error
                    },
                    results: [],
                    keywords: []
                };
            }
            if (seenSequenceIds.has(record.sequence_id)) {
                return {
                    success: false,
                    status: "invalid_batch",
                    error: {
                        code: "DUPLICATE_SEQUENCE_ID",
                        sequence_id: record.sequence_id,
                        message: `Batch contains duplicate sequence_id ${record.sequence_id}.`
                    },
                    results: [],
                    keywords: []
                };
            }
            seenSequenceIds.add(record.sequence_id);
        }

        const sortedRecords = [...records].sort(
            (left, right) => left.sequence_id - right.sequence_id
        );
        const results = [];

        for (const record of sortedRecords) {
            results.push(await recognizeRecord(record, recognitionOptions));
        }

        return {
            success: true,
            status: "processed",
            results,
            keywords: results
                .filter(result =>
                    result.status === "recognized" ||
                    result.status === "no_match"
                )
                .map(result => result.keyword)
        };
    }

    return {
        initialize,
        recognizeRecord,
        processBatch
    };
}

module.exports = {
    createRecognitionEngine
};
