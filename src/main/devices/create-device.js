const { create } = require("../../models/Device");
const generateSecret = require("../../utils/generateSecret");

const createNewDevice = async (name) => {
    try {
        const deviceId = `device-${Date.now()}`;
        const secret = generateSecret();
        await create(deviceId, name, secret);
        return { id: deviceId, name, secret };
    } catch (error) {
        throw error;
    }
};

const createDevice = async (deviceData) => {
    const { name } = deviceData;

    try {
        const device = await createNewDevice(name);

        return Promise.resolve({
            status: "success",
            message: "Device created successfully",
            device: device,
        });

    } catch (err) {
        console.error("Error creating device:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while creating device",
        });
    }
};

module.exports = { createDevice };
