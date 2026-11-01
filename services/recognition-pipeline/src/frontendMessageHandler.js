function errorResponse(code, message) {
    return {
        type: "ERROR",
        code,
        message
    };
}

async function handleFrontendMessage(
    rawMessage,
    customGestureManager,
    emergencyMode = {}
) {
    let request;

    try {
        request = JSON.parse(
            Buffer.isBuffer(rawMessage)
                ? rawMessage.toString("utf8")
                : rawMessage
        );
    } catch {
        return errorResponse("INVALID_JSON", "The message must contain valid JSON.");
    }

    if (request === null ||
        typeof request !== "object" ||
        Array.isArray(request) ||
        typeof request.type !== "string") {
        return errorResponse(
            "INVALID_MESSAGE",
            "The request must be a JSON object with a string type."
        );
    }

    switch (request.type) {
        case "GET_CUSTOM_GESTURES":
            return {
                type: "CUSTOM_GESTURES",
                gestures: customGestureManager.getCustomGestures()
            };

        case "GET_SELECTED_GESTURE": {
            const selected = await customGestureManager.getSelectedGesture();
            return {
                type: "SELECTED_GESTURE",
                selectedGesture: selected ? selected.id : null,
                name: selected ? selected.name : null
            };
        }

        case "GET_CUSTOM_GESTURE_ASSIGNMENTS":
            return {
                type: "CUSTOM_GESTURE_ASSIGNMENTS",
                gestures: await customGestureManager
                    .getCustomGestureAssignments()
            };

        case "ADD_CUSTOM_GESTURE": {
            const allowedFields = new Set(["type", "name", "sentence"]);
            if (Object.keys(request).some(field => !allowedFields.has(field))) {
                return errorResponse(
                    "INVALID_MESSAGE",
                    "Only name and optional sentence may be provided; patterns are predefined."
                );
            }
            if (typeof request.name !== "string") {
                return errorResponse(
                    "INVALID_MESSAGE",
                    "name must be a string."
                );
            }
            if (request.sentence !== undefined &&
                typeof request.sentence !== "string") {
                return errorResponse(
                    "INVALID_MESSAGE",
                    "sentence must be a string when provided."
                );
            }

            try {
                const result = await customGestureManager.addCustomGesture(
                    request.name,
                    request.sentence === undefined ? null : request.sentence
                );
                return {
                    type: "CUSTOM_GESTURE_ADD_RESULT",
                    ...result
                };
            } catch {
                return errorResponse(
                    "PERSISTENCE_FAILED",
                    "The custom gesture assignment could not be saved."
                );
            }
        }

        case "DELETE_CUSTOM_GESTURE": {
            if (typeof request.id !== "string" ||
                Object.keys(request).some(field =>
                    field !== "type" && field !== "id")) {
                return errorResponse(
                    "INVALID_MESSAGE",
                    "id must identify an assigned custom gesture slot."
                );
            }

            try {
                const result = await customGestureManager
                    .deleteCustomGesture(request.id);
                return {
                    type: "CUSTOM_GESTURE_DELETE_RESULT",
                    ...result
                };
            } catch {
                return errorResponse(
                    "PERSISTENCE_FAILED",
                    "The custom gesture assignment could not be deleted."
                );
            }
        }

        case "GET_EMERGENCY_MODE":
            return {
                type: "EMERGENCY_MODE_STATUS",
                active: typeof emergencyMode.isActive === "function"
                    ? emergencyMode.isActive()
                    : false
            };

        case "ACTIVATE_EMERGENCY_MODE":
        case "DEACTIVATE_EMERGENCY_MODE": {
            if (Object.keys(request).length !== 1) {
                return errorResponse(
                    "INVALID_MESSAGE",
                    "Emergency mode controls must contain only a type."
                );
            }
            if (typeof emergencyMode.setActive !== "function") {
                return errorResponse(
                    "EMERGENCY_MODE_UNAVAILABLE",
                    "Emergency mode control is not configured."
                );
            }
            const active = request.type === "ACTIVATE_EMERGENCY_MODE";
            emergencyMode.setActive(active);
            return {
                type: "EMERGENCY_MODE_STATUS",
                active
            };
        }

        case "CUSTOM_GESTURE_SELECTION": {
            if (typeof request.selectedGesture !== "string") {
                return errorResponse(
                    "INVALID_MESSAGE",
                    "selectedGesture must be a string."
                );
            }

            try {
                const result = await customGestureManager
                    .selectCustomGesture(request.selectedGesture);
                if (!result.success) {
                    return {
                        type: "CUSTOM_GESTURE_SELECTION_RESULT",
                        success: false,
                        selectedGesture: null,
                        error: result.error
                    };
                }

                return {
                    type: "CUSTOM_GESTURE_SELECTION_RESULT",
                    success: true,
                    selectedGesture: result.selectedGesture,
                    name: result.name
                };
            } catch {
                return errorResponse(
                    "PERSISTENCE_FAILED",
                    "The selection could not be saved."
                );
            }
        }

        default:
            return errorResponse(
                "UNKNOWN_OPERATION",
                "The requested operation is not supported."
            );
    }
}

module.exports = {
    handleFrontendMessage
};
