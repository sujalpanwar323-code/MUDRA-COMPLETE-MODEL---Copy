const KEYWORD_MESSAGE_TYPE = "recognized_keywords";

function buildEmergencyPayload(result) {
    if (!result || typeof result !== "object") {
        throw new TypeError("Emergency recognition result must be an object.");
    }
    const matched = result.status === "recognized" &&
        typeof result.keyword === "string" && result.keyword.trim() !== "";
    return {
        type: "EMERGENCY_RESULT",
        mode: "EMERGENCY",
        trigger: result.emergency_mode === true ? "hardware" : "frontend",
        status: matched ? "MATCH" : "NO_MATCH",
        sequence_id: Number.isSafeInteger(result.sequence_id)
            ? result.sequence_id
            : null,
        ...(matched ? { sentence: result.keyword } : {})
    };
}

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
    buildEmergencyPayload,
    buildKeywordPayload,
    deliverPayload,
    serializeKeywordPayload
};
