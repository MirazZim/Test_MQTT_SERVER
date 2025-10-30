// src/mqtt/base/BaseSensorHandler.js
const { Mutex } = require('async-mutex');

class BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex, mqttHandler) { // ✅ ADD mqttHandler param
        this.io = io;
        this.sensorData = sensorData;
        this.activeUsers = activeUsers;
        this.sensorDataMutex = sensorDataMutex;
        this.mqttHandler = mqttHandler; // ✅ STORE IT
    }

    async updateSensorCache(key, value) {
        const release = await this.sensorDataMutex.acquire();
        try {
            this.sensorData[key] = value;
            console.log(`🔄 Updated ${key}: ${value}`);
        } finally {
            release();
        }
    }

    validateNumeric(value, min = -Infinity, max = Infinity) {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < min || numValue > max) {
            console.warn(`⚠️ Invalid value: ${value}`);
            return { valid: false };
        }
        return { valid: true, value: numValue };
    }
}

module.exports = BaseSensorHandler;
