// mqtt/base/BaseSensorHandler.js
// ✅ UPDATED FOR redesigned_iot_database schema
const { Mutex } = require('async-mutex');

class BaseSensorHandler {
    constructor(io, sensorData, activeUsers, sensorDataMutex) {
        this.io = io;
        this.sensorData = sensorData;
        this.activeUsers = activeUsers;
        this.sensorDataMutex = sensorDataMutex;
        console.log(`🔵 [BaseSensorHandler] Initialized`);
    }

    async updateSensorCache(key, value) {
        const release = await this.sensorDataMutex.acquire();
        try {
            this.sensorData[key] = value;
            console.log(`🔄 [BaseSensorHandler] Updated cache: ${key} = ${value}`);
        } finally {
            release();
        }
    }

    validateNumeric(value, min = -Infinity, max = Infinity) {
        const numValue = parseFloat(value);
        if (isNaN(numValue) || numValue < min || numValue > max) {
            console.warn(`⚠️ [BaseSensorHandler] Invalid value: ${value} (min: ${min}, max: ${max})`);
            return { valid: false };
        }
        return { valid: true, value: numValue };
    }

    updateCache(key, value) {
        this.sensorData[key] = value;
        console.log(`🔄 [BaseSensorHandler] Cache updated: ${key} = ${value}`);
    }
}

module.exports = BaseSensorHandler;
