const { store } = require("../../models/Message");

const storeSimulatedMessage = async (deviceId, topic, message) => {
    try {
        await store(deviceId, topic, message, 1);
        return true;
    } catch (error) {
        throw error;
    }
};

const simulateMessage = async (messageData) => {
    const { deviceId, topic, message } = messageData;

    try {
        await storeSimulatedMessage(deviceId, topic, message);

        return Promise.resolve({
            status: "success",
            message: "Message stored successfully",
        });

    } catch (err) {
        console.error("Error simulating message:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while storing message",
        });
    }
};

module.exports = { simulateMessage };
