// src/mqtt/utils/ValidationUtils.js

class ValidationUtils {
    static validateIncomingMessage(topic, message) {
        try {
            // Check message size
            if (message.length > 50000) {
                console.warn(`Message too large: ${message.length} bytes`);
                return false;
            }

            // Validate topic format
            if (!/^[a-zA-Z0-9/_+-]+$/.test(topic)) {
                console.warn(`Invalid topic format: ${topic}`);
                return false;
            }

            // For sensor topics
            if (topic === "ESP" || topic === "ESP2") {
                const value = parseFloat(message.toString());
                if (!Number.isFinite(value)) {
                    console.warn(`Non-numeric sensor value: ${message}`);
                    return false;
                }
                return true;
            }

            // For JSON messages
            if (topic.includes('environment') || topic.includes('setpoint')) {
                try {
                    JSON.parse(message.toString());
                    return true;
                } catch (e) {
                    console.warn(`Invalid JSON: ${e.message}`);
                    return false;
                }
            }

            return true;
        } catch (error) {
            console.error('Validation error:', error);
            return true; // Allow on error
        }
    }
}

module.exports = ValidationUtils;
