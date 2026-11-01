const KEYWORD_MESSAGE_TYPE = "recognized_keywords";

function buildKeywordPayload(results) {
    if (!Array.isArray(results)) {
        throw new TypeError("Recognition results must be an array.");
    }

    const keywords = [];
    for (const result of results) {
        if (result === null || typeof result !== "object") {
            throw new TypeError("Each recognition result must be an object.");
        }
        if (result.status === "recognized" || result.status === "no_match") {
            if (typeof result.keyword !== "string" ||
                result.keyword.trim() === "") {
                throw new TypeError(
                    "Recognized results must contain a nonempty keyword."
                );
            }
            keywords.push(result.keyword);
        }
    }

    return keywords.length > 0
        ? { type: KEYWORD_MESSAGE_TYPE, keywords }
        : null;
}

function buildEmergencyPayload(result) {
    if (result === null || typeof result !== "object") {
        throw new TypeError("An emergency recognition result must be an object.");
    }
    if (!Number.isSafeInteger(result.sequence_id)) {
        throw new TypeError(
            "An emergency recognition result must contain a safe sequence_id."
        );
    }

    if (result.status === "recognized" &&
        result.source === "fallback" &&
        typeof result.keyword === "string" &&
        result.keyword.trim() !== "") {
        return {
            type: "EMERGENCY_RESULT",
            mode: "EMERGENCY",
            status: "MATCH",
            sequence_id: result.sequence_id,
            sentence: result.keyword
        };
    }

    if (result.status === "no_match" && result.source === "fallback") {
        return {
            type: "EMERGENCY_RESULT",
            mode: "EMERGENCY",
            status: "NO_MATCH",
            sequence_id: result.sequence_id,
            sentence: null
        };
    }

    return null;
}

function serializeKeywordPayload(payload) {
    if (!payload ||
        typeof payload !== "object" ||
        payload.type !== KEYWORD_MESSAGE_TYPE ||
        !Array.isArray(payload.keywords) ||
        payload.keywords.length === 0 ||
        payload.keywords.some(keyword =>
            typeof keyword !== "string" || keyword.trim() === "")) {
        throw new TypeError(
            "Payload must contain recognized_keywords and a nonempty string keywords array."
        );
    }

    return JSON.stringify(payload);
}

function serializeEmergencyPayload(payload) {
    const validBase = payload &&
        typeof payload === "object" &&
        payload.type === "EMERGENCY_RESULT" &&
        payload.mode === "EMERGENCY" &&
        Number.isSafeInteger(payload.sequence_id);
    const validMatch = validBase &&
        payload.status === "MATCH" &&
        typeof payload.sentence === "string" &&
        payload.sentence.trim() !== "";
    const validNoMatch = validBase &&
        payload.status === "NO_MATCH" &&
        payload.sentence === null;

    if (!validMatch && !validNoMatch) {
        throw new TypeError("Payload must contain a valid EMERGENCY_RESULT.");
    }

    return JSON.stringify(payload);
}

function serializeOutboundPayload(payload) {
    if (payload && payload.type === "recognized_keywords") {
        return serializeKeywordPayload(payload);
    }
    if (payload && payload.type === "EMERGENCY_RESULT") {
        return serializeEmergencyPayload(payload);
    }
    if (payload && (payload.type === "telemetry" || payload.type === "sensor_telemetry" || payload.type === "diagnostic_status")) {
        return JSON.stringify(payload);
    }
    throw new TypeError("Unsupported WebSocket output payload type.");
}

async function deliverPayload(payload, send) {
    if (payload === null) {
        return {
            success: true,
            status: "skipped",
            reason: "No recognized keywords."
        };
    }

    if (!payload ||
        typeof payload !== "object" ||
        !Array.isArray(payload.keywords)) {
        throw new TypeError(
            "Payload must contain recognized_keywords and a nonempty string keywords array."
        );
    }

    serializeKeywordPayload(payload);

    if (typeof send !== "function") {
        throw new TypeError("A transport send function is required.");
    }

    try {
        const deliveryResult = await send(payload);

        if (deliveryResult && deliveryResult.success === false) {
            return deliveryResult;
        }

        return {
            success: true,
            status: "send_accepted",
            message: "The transport accepted the send operation; peer receipt is not confirmed."
        };

    } catch (error) {
        return {
            success: false,
            status: "failed",
            error: {
                code: "DELIVERY_FAILED",
                message: "The keyword payload could not be sent.",
                cause: error.message
            }
        };
    }
}

module.exports = {
    KEYWORD_MESSAGE_TYPE,
    buildKeywordPayload,
    buildEmergencyPayload,
    deliverPayload,
    serializeKeywordPayload,
    serializeEmergencyPayload,
    serializeOutboundPayload
};
