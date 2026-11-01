const path = require("node:path");
const {
    loadJsonFile,
    validateStandardLibrary,
    validateCustomLibrary,
    validateFallbackLibrary
} = require("./libraries");
const {
    createCustomGestureManager,
    customDefinitions
} = require("./customGestures");
const { createSelectionStore } = require("./selectionStore");
const { createRecognitionEngine } = require("./recognizer");
const { adaptModule2Message } = require("./module2InputAdapter");
const { handleFrontendMessage } = require("./frontendMessageHandler");
const {
    buildKeywordPayload,
    buildEmergencyPayload,
    deliverPayload
} = require("./outputAdapter");
const { createWebSocketAdapter } = require("./webSocketAdapter");

const dataDirectory = path.join(__dirname, "..", "data");
const defaultStandardLibrary = validateStandardLibrary(
    loadJsonFile(
        path.join(dataDirectory, "gestureLibrary.json"),
        "Standard gesture library"
    )
);
const defaultCustomLibrary = validateCustomLibrary(
    loadJsonFile(
        path.join(dataDirectory, "customGestures.json"),
        "Custom gesture library"
    )
);
const defaultFallbackLibrary = validateFallbackLibrary(
    loadJsonFile(
        path.join(dataDirectory, "fallbackLibrary.json"),
        "Fallback library"
    )
);

const DEFAULT_FRONTEND_WEBSOCKET = Object.freeze({
    host: "127.0.0.1",
    port: 8080
});

function createModule3(options = {}) {
    const customLibrary = options.customLibrary || defaultCustomLibrary;
    const customGestureManager = options.customGestureManager ||
        createCustomGestureManager({
            definitions: customLibrary,
            selectionFilePath: options.selectionFilePath,
            store: options.selectionStore
        });
    const engine = createRecognitionEngine({
        standardLibrary: options.standardLibrary || defaultStandardLibrary,
        expectedStandardCount: options.expectedStandardCount,
        customLibrary,
        expectedCustomCount: options.expectedCustomCount,
        customGestureManager,
        fallbackLibrary: options.fallbackLibrary || defaultFallbackLibrary
    });
    const frontendWebSocket = options.frontendWebSocket === undefined
        ? {}
        : options.frontendWebSocket;
    if (frontendWebSocket === null ||
        typeof frontendWebSocket !== "object" ||
        Array.isArray(frontendWebSocket)) {
        throw new TypeError("frontendWebSocket must be a configuration object.");
    }
    if (frontendWebSocket.role !== undefined &&
        frontendWebSocket.role !== "server") {
        throw new TypeError(
            'Module 3 frontend WebSocket role must be "server".'
        );
    }
    const frontendTransport = createWebSocketAdapter({
        role: "server",
        host: frontendWebSocket.host === undefined
            ? DEFAULT_FRONTEND_WEBSOCKET.host
            : frontendWebSocket.host,
        port: frontendWebSocket.port === undefined
            ? DEFAULT_FRONTEND_WEBSOCKET.port
            : frontendWebSocket.port
    });
    let emergencyModeActive = false;

    function setEmergencyMode(active) {
        if (typeof active !== "boolean") {
            throw new TypeError("Emergency mode must be a Boolean.");
        }
        emergencyModeActive = active;
        return emergencyModeActive;
    }

    function getRecognitionOptions(recognitionOptions) {
        return {
            ...recognitionOptions,
            emergencyMode: emergencyModeActive
        };
    }

    function sendEmergencyResults(results) {
        const payloads = results
            .map(buildEmergencyPayload)
            .filter(payload => payload !== null);
        if (payloads.length === 0) {
            return null;
        }

        const deliveries = payloads.map(payload =>
            frontendTransport.send(payload)
        );
        const failedDelivery = deliveries.find(delivery =>
            delivery.success === false);
        if (failedDelivery) {
            return {
                ...failedDelivery,
                messages: deliveries.length,
                partial: deliveries.some(delivery => delivery.success === true)
            };
        }

        return {
            success: true,
            status: "send_accepted",
            messages: deliveries.length,
            recipients: Math.min(...deliveries.map(delivery =>
                delivery.recipients))
        };
    }

    frontendTransport.on("frontendMessage", (message, socket) => {
        Promise.resolve()
            .then(async () => {
                await customGestureManager.initialize();
                return handleFrontendMessage(message, customGestureManager, {
                    isActive: () => emergencyModeActive,
                    setActive: setEmergencyMode
                });
            })
            .catch(() => ({
                type: "ERROR",
                code: "REQUEST_FAILED",
                message: "The frontend request could not be processed."
            }))
            .then(response => {
                frontendTransport.sendControlMessage(socket, response);
            });
    });

    async function recognizeRecord(record, recognitionOptions) {
        const optionsSnapshot = getRecognitionOptions(recognitionOptions);
        const result = await engine.recognizeRecord(
            record,
            optionsSnapshot
        );
        if (frontendTransport &&
            (result.status === "recognized" || result.status === "no_match")) {
            result.delivery = optionsSnapshot.emergencyMode
                ? sendEmergencyResults([result])
                : frontendTransport.send(buildKeywordPayload([result]));
        }
        return result;
    }

    async function processBatch(records, recognitionOptions) {
        // Snapshot mode at batch entry; mid-batch toggles affect the next batch.
        const optionsSnapshot = getRecognitionOptions(recognitionOptions);
        const result = await engine.processBatch(
            records,
            optionsSnapshot
        );
        if (frontendTransport && result.success) {
            if (optionsSnapshot.emergencyMode) {
                const delivery = sendEmergencyResults(result.results);
                if (delivery) {
                    result.delivery = delivery;
                }
            } else {
                const payload = buildKeywordPayload(result.results);
                if (payload) {
                    result.delivery = frontendTransport.send(payload);
                }
            }
        }
        return result;
    }

    async function processModule2Message(message, recognitionOptions) {
        const adapted = adaptModule2Message(message);
        if (!adapted.valid) {
            return {
                success: false,
                status: "invalid_message",
                error: adapted.error,
                results: [],
                keywords: []
            };
        }
        return processBatch(adapted.records, recognitionOptions);
    }

    return {
        initialize: engine.initialize,
        recognizeRecord,
        processBatch,
        processModule2Message,
        addCustomGesture: (name, sentence) =>
            customGestureManager.addCustomGesture(name, sentence),
        deleteCustomGesture: slotId =>
            customGestureManager.deleteCustomGesture(slotId),
        getCustomGestureAssignments: () =>
            customGestureManager.getCustomGestureAssignments(),
        setEmergencyMode,
        isEmergencyModeActive: () => emergencyModeActive,
        getCustomGestures: () =>
            customGestureManager.getCustomGestures(),
        getSelectedGesture: async () => {
            await engine.initialize();
            return customGestureManager.getSelectedGesture();
        },
        selectCustomGesture: async gestureId => {
            await engine.initialize();
            return customGestureManager.selectCustomGesture(gestureId);
        },
        customGestureManager,
        handleFrontendMessage: async message => {
            await customGestureManager.initialize();
            return handleFrontendMessage(message, customGestureManager, {
                isActive: () => emergencyModeActive,
                setActive: setEmergencyMode
            });
        },
        buildKeywordPayload,
        deliverPayload,
        frontendTransport,
        webSocketAdapter: frontendTransport,
        startFrontendTransport: () => frontendTransport.start(),
        closeFrontendTransport: () => frontendTransport.close(),
        startWebSocketServer: () => frontendTransport.start(),
        closeWebSocketServer: () => frontendTransport.close()
    };
}

const defaultModule3 = createModule3();

module.exports = {
    createModule3,
    recognizeRecord: (...args) => defaultModule3.recognizeRecord(...args),
    processBatch: (...args) => defaultModule3.processBatch(...args),
    processModule2Message: (...args) =>
        defaultModule3.processModule2Message(...args),
    addCustomGesture: (...args) => defaultModule3.addCustomGesture(...args),
    deleteCustomGesture: (...args) =>
        defaultModule3.deleteCustomGesture(...args),
    getCustomGestureAssignments: () =>
        defaultModule3.getCustomGestureAssignments(),
    setEmergencyMode: active => defaultModule3.setEmergencyMode(active),
    isEmergencyModeActive: () => defaultModule3.isEmergencyModeActive(),
    getCustomGestures: () =>
        defaultModule3.customGestureManager.getCustomGestures(),
    getSelectedGesture: async () => {
        await defaultModule3.initialize();
        return defaultModule3.customGestureManager.getSelectedGesture();
    },
    selectCustomGesture: async gestureId => {
        await defaultModule3.initialize();
        return defaultModule3.customGestureManager.selectCustomGesture(gestureId);
    },
    handleFrontendMessage: defaultModule3.handleFrontendMessage,
    buildKeywordPayload,
    deliverPayload,
    startFrontendTransport: (...args) =>
        defaultModule3.startFrontendTransport(...args),
    closeFrontendTransport: (...args) =>
        defaultModule3.closeFrontendTransport(...args),
    startWebSocketServer: (...args) =>
        defaultModule3.startWebSocketServer(...args),
    closeWebSocketServer: (...args) =>
        defaultModule3.closeWebSocketServer(...args)
};
