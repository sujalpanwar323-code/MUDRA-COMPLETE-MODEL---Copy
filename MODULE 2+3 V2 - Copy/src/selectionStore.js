const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

function isObject(value) {
    return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value);
}

function copyAssignments(items) {
    return items.map(assignment => ({ ...assignment }));
}

function createSelectionStore(options = {}) {
    const filePath = options.filePath ||
        path.join(__dirname, "..", "data", "selection.json");
    const fileSystem = options.fileSystem || fs;
    let allowedIds = new Set();
    let selectedGesture = null;
    let assignments = [];
    let initialization;
    let queue = Promise.resolve();

    async function writeAtomically(state) {
        const directory = path.dirname(filePath);
        const temporaryPath = path.join(
            directory,
            `${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
        );

        try {
            await fileSystem.writeFile(
                temporaryPath,
                `${JSON.stringify(state, null, 2)}\n`,
                { encoding: "utf8", flag: "wx" }
            );
            await fileSystem.rename(temporaryPath, filePath);
        } catch (error) {
            try {
                await fileSystem.unlink(temporaryPath);
            } catch (cleanupError) {
                if (cleanupError.code !== "ENOENT") {
                    error.cleanupError = cleanupError;
                }
            }
            throw new Error("Could not persist the custom gesture state.", {
                cause: error
            });
        }
    }

    function validateAssignments(value) {
        if (value === undefined) {
            return [];
        }
        if (!Array.isArray(value)) {
            throw new Error("Selection file assignments must be an array.");
        }

        const seenIds = new Set();
        return value.map((assignment, index) => {
            if (!isObject(assignment) ||
                typeof assignment.slotId !== "string" ||
                !allowedIds.has(assignment.slotId) ||
                seenIds.has(assignment.slotId)) {
                throw new Error(
                    `Selection file contains an invalid assignment at index ${index}.`
                );
            }
            if (typeof assignment.name !== "string" ||
                assignment.name.trim() === "") {
                throw new Error(
                    `Selection file assignment ${index} must have a nonempty name.`
                );
            }
            if (assignment.sentence !== null &&
                assignment.sentence !== undefined &&
                (typeof assignment.sentence !== "string" ||
                    assignment.sentence.trim() === "")) {
                throw new Error(
                    `Selection file assignment ${index} has an invalid sentence.`
                );
            }

            seenIds.add(assignment.slotId);
            return {
                slotId: assignment.slotId,
                name: assignment.name.trim(),
                sentence: assignment.sentence
                    ? assignment.sentence.trim()
                    : null
            };
        });
    }

    async function persistState(nextSelection, nextAssignments) {
        await writeAtomically({
            selectedGesture: nextSelection,
            assignments: copyAssignments(nextAssignments)
        });
        selectedGesture = nextSelection;
        assignments = copyAssignments(nextAssignments);
    }

    async function initialize(gestureIds) {
        if (initialization) {
            return initialization;
        }

        if (!Array.isArray(gestureIds)) {
            throw new TypeError("Custom gesture slot IDs must be an array.");
        }
        const nextAllowedIds = new Set(gestureIds);
        if (nextAllowedIds.size !== gestureIds.length ||
            gestureIds.some(id => typeof id !== "string" || id.trim() === "")) {
            throw new TypeError("Custom gesture slot IDs must be unique nonempty strings.");
        }
        allowedIds = nextAllowedIds;

        initialization = (async () => {
            let data;

            try {
                const text = await fileSystem.readFile(filePath, "utf8");
                try {
                    data = JSON.parse(text);
                } catch (error) {
                    throw new Error("Selection file contains malformed JSON.", {
                        cause: error
                    });
                }
            } catch (error) {
                if (error.code !== "ENOENT") {
                    throw error;
                }

                await persistState(null, []);
                data = { selectedGesture: null, assignments: [] };
            }

            if (!isObject(data) ||
                !Object.prototype.hasOwnProperty.call(data, "selectedGesture")) {
                throw new Error("Selection file must contain selectedGesture.");
            }

            const selection = data.selectedGesture;
            if (selection !== null &&
                (typeof selection !== "string" || !allowedIds.has(selection))) {
                throw new Error("Selection file contains an unknown gesture ID.");
            }

            selectedGesture = selection;
            assignments = validateAssignments(data.assignments);
            return selectedGesture;
        })();

        try {
            return await initialization;
        } catch (error) {
            initialization = undefined;
            throw error;
        }
    }

    async function withUpdateLock(action) {
        let release;
        const previous = queue;
        queue = new Promise(resolve => {
            release = resolve;
        });
        await previous;

        try {
            return await action();
        } finally {
            release();
        }
    }

    async function setSelectedGesture(gestureId) {
        if (!allowedIds.has(gestureId)) {
            return {
                success: false,
                error: {
                    code: "INVALID_GESTURE_ID",
                    message: "The requested custom gesture ID is not available."
                }
            };
        }

        return withUpdateLock(async () => {
            await persistState(gestureId, assignments);
            return {
                success: true,
                selectedGesture
            };
        });
    }

    async function assignFirstAvailable(name, sentence = null) {
        return withUpdateLock(async () => {
            const assignedIds = new Set(
                assignments.map(assignment => assignment.slotId)
            );
            const slotId = [...allowedIds].find(id => !assignedIds.has(id));
            if (!slotId) {
                return {
                    success: false,
                    error: {
                        code: "CUSTOM_GESTURE_SLOTS_FULL",
                        message: "All custom gesture slots are assigned."
                    }
                };
            }

            const assignment = {
                slotId,
                name: name.trim(),
                sentence: sentence === null ? null : sentence.trim()
            };
            const nextAssignments = [...assignments, assignment];
            await persistState(selectedGesture, nextAssignments);
            return {
                success: true,
                assignment: { ...assignment }
            };
        });
    }

    async function deleteAssignment(slotId) {
        return withUpdateLock(async () => {
            const assignment = assignments.find(item => item.slotId === slotId);
            if (!assignment) {
                return {
                    success: false,
                    error: {
                        code: "CUSTOM_GESTURE_NOT_ASSIGNED",
                        message: "The requested custom gesture slot is not assigned."
                    }
                };
            }

            const nextSelection = selectedGesture === slotId
                ? null
                : selectedGesture;
            const nextAssignments = assignments.filter(
                item => item.slotId !== slotId
            );
            await persistState(nextSelection, nextAssignments);
            return {
                success: true,
                deletedGesture: slotId
            };
        });
    }

    return {
        initialize,
        getSelectedGesture: async () => {
            if (!initialization) {
                throw new Error("Selection store has not been initialized.");
            }
            await initialization;
            return selectedGesture;
        },
        getAssignments: async () => {
            if (!initialization) {
                throw new Error("Selection store has not been initialized.");
            }
            await initialization;
            return copyAssignments(assignments);
        },
        setSelectedGesture,
        assignFirstAvailable,
        deleteAssignment
    };
}

module.exports = {
    createSelectionStore
};
