const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildKeywordPayload,
    deliverPayload,
    serializeKeywordPayload
} = require("../src/outputAdapter");

test("builds ordered payload from recognized results only", () => {
    const results = [
        { status: "recognized", keyword: "FIRST" },
        { status: "unknown", keyword: null },
        { status: "recognized", keyword: "SECOND" },
        { status: "reserved", keyword: null }
    ];
    assert.deepEqual(buildKeywordPayload(results), {
        type: "recognized_keywords",
        keywords: ["FIRST", "SECOND"]
    });
});

test("does not construct an empty payload", () => {
    assert.equal(buildKeywordPayload([]), null);
    assert.equal(buildKeywordPayload([
        { status: "unknown", keyword: null }
    ]), null);
});

test("includes the emergency NO_MATCH result in the existing keyword payload", () => {
    assert.deepEqual(buildKeywordPayload([{
        status: "no_match",
        source: "fallback",
        keyword: "NO_MATCH"
    }]), {
        type: "recognized_keywords",
        keywords: ["NO_MATCH"]
    });
});

test("serializes the proposed frontend message contract", () => {
    const payload = buildKeywordPayload([
        { status: "recognized", keyword: "HELLO" },
        { status: "recognized", keyword: "MY" }
    ]);

    assert.equal(
        serializeKeywordPayload(payload),
        '{"type":"recognized_keywords","keywords":["HELLO","MY"]}'
    );
});

test("reports send acceptance without claiming peer receipt", async () => {
    let received;
    const result = await deliverPayload(
        { type: "recognized_keywords", keywords: ["HELLO"] },
        async payload => { received = payload; }
    );
    assert.deepEqual(received, {
        type: "recognized_keywords",
        keywords: ["HELLO"]
    });
    assert.equal(result.status, "send_accepted");
    assert.match(result.message, /peer receipt is not confirmed/);
});

test("reports transport failure separately", async () => {
    const result = await deliverPayload(
        { type: "recognized_keywords", keywords: ["HELLO"] },
        async () => { throw new Error("offline"); }
    );
    assert.equal(result.success, false);
    assert.equal(result.error.code, "DELIVERY_FAILED");
});

test("skips empty recognition output without sending", async () => {
    let called = false;
    const payload = buildKeywordPayload([]);
    const result = await deliverPayload(payload, async () => { called = true; });
    assert.equal(called, false);
    assert.equal(result.status, "skipped");
});

test("rejects malformed payloads and missing send functions", async () => {
    await assert.rejects(
        deliverPayload({
            type: "recognized_keywords",
            keywords: []
        }, async () => {}),
        TypeError
    );
    await assert.rejects(
        deliverPayload({
            type: "recognized_keywords",
            keywords: ["HELLO"]
        }, null),
        TypeError
    );
    assert.throws(
        () => serializeKeywordPayload({
            type: "recognized_keywords",
            keywords: [""]
        }),
        TypeError
    );
    assert.throws(
        () => buildKeywordPayload([{ status: "recognized", keyword: "" }]),
        TypeError
    );
});
