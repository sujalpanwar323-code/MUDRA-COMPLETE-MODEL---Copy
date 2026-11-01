const { validateRecord } = require("./validateInput");

function isReservedState(record) {
    const validation = validateRecord(record);

    if (!validation.valid) {
        throw new TypeError(validation.error);
    }

    return false;
}

module.exports = {
    isReservedState
};