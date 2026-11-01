const { validateFallbackLibrary } = require("./libraries");
const { createFlexPattern } = require("./patternKeys");

function createFallbackRecognizer(library) {
    const libraryData = Array.isArray(library)
        ? {
            status: "DEMONSTRATION_ONLY_UNCALIBRATED",
            sentences: library
        }
        : library;
    const entries = validateFallbackLibrary(libraryData);
    const sentenceByPattern = new Map(
        entries.map(entry => [entry.pattern, entry.sentence])
    );

    return {
        createFlexPattern,
        recognize: record => sentenceByPattern.get(createFlexPattern(record)) || null
    };
}

module.exports = {
    createFallbackRecognizer
};
