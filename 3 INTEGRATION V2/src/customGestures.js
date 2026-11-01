const path = require("node:path");
const {
    loadJsonFile,
    validateCustomLibrary
} = require("./libraries");
const { createSelectionStore } = require("./selectionStore");

const customLibraryPath = path.join(__dirname, "..", "data", "customGestures.json");
const customDefinitions = validateCustomLibrary(
    loadJsonFile(customLibraryPath, "Custom gesture library")
);

function createCustomGestureManager(options = {}) {
    const suppliedDefinitions = options.definitions || customDefinitions;
    const definitions = validateCustomLibrary({
        status: "DEMONSTRATION_ONLY_UNCALIBRATED",
        gestures: suppliedDefinitions
    });
    const store = options.store || createSelectionStore({
        filePath: options.selectionFilePath
    });
    const gestureIds = definitions.map(gesture => gesture.id);
    const gesturesById = new Map(
        definitions.map(gesture => [gesture.id, gesture])
    );
    const assignmentById = async () => {
        await store.initialize(gestureIds);
        const assignments = await store.getAssignments();
        return new Map(
            assignments.map(assignment => [assignment.slotId, assignment])
        );
    };

    return {
        initialize: () => store.initialize(gestureIds),
        getCustomGestures: () => definitions.map(({ id, name }) => ({ id, name })),
        getCustomGestureAssignments: async () => {
            await store.initialize(gestureIds);
            return (await store.getAssignments()).map(assignment => ({
                id: assignment.slotId,
                name: assignment.name,
                sentence: assignment.sentence
            }));
        },
        addCustomGesture: async (name, sentence = null) => {
            if (typeof name !== "string" || name.trim() === "") {
                return {
                    success: false,
                    error: {
                        code: "INVALID_CUSTOM_GESTURE_NAME",
                        message: "A nonempty custom gesture name is required."
                    }
                };
            }
            if (sentence !== null &&
                (typeof sentence !== "string" || sentence.trim() === "")) {
                return {
                    success: false,
                    error: {
                        code: "INVALID_CUSTOM_GESTURE_SENTENCE",
                        message: "The optional sentence must be a nonempty string."
                    }
                };
            }

            await store.initialize(gestureIds);
            const result = await store.assignFirstAvailable(
                name,
                sentence
            );
            if (!result.success) {
                return result;
            }
            return {
                success: true,
                assignedGesture: {
                    id: result.assignment.slotId,
                    name: result.assignment.name,
                    sentence: result.assignment.sentence
                }
            };
        },
        deleteCustomGesture: async slotId => {
            await store.initialize(gestureIds);
            return store.deleteAssignment(slotId);
        },
        getSelectedGesture: async () => {
            const selectedGesture = await store.getSelectedGesture();
            return selectedGesture === null
                ? null
                : {
                    id: selectedGesture,
                    name: (await assignmentById()).get(selectedGesture)?.name ||
                        gesturesById.get(selectedGesture).name
                };
        },
        selectCustomGesture: async gestureId => {
            const result = await store.setSelectedGesture(gestureId);
            if (!result.success) {
                return result;
            }

            return {
                success: true,
                selectedGesture: result.selectedGesture,
                name: gesturesById.get(result.selectedGesture).name
            };
        },
        getSelectedCustomPattern: async () => {
            const selectedGesture = await store.getSelectedGesture();
            if (selectedGesture === null) {
                return null;
            }

            const selected = gesturesById.get(selectedGesture);
            if (!selected) {
                return null;
            }
            const assignment = (await assignmentById()).get(selectedGesture);
            return {
                ...selected,
                name: assignment ? assignment.name : selected.name,
                sentence: assignment ? assignment.sentence : null
            };
        },
        getAssignedCustomPatterns: async () => {
            await store.initialize(gestureIds);
            const assignments = await assignmentById();
            return definitions
                .filter(definition => assignments.has(definition.id))
                .map(definition => ({
                    ...definition,
                    name: assignments.get(definition.id).name,
                    sentence: assignments.get(definition.id).sentence
                }));
        }
    };
}

module.exports = {
    createCustomGestureManager,
    customDefinitions
};
