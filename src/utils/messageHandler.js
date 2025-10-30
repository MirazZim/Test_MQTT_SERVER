const pool = require("../config/db");
const EventEmitter = require("events");

const messageEmitter = new EventEmitter();

const storeMessage = async ({ deviceId, topic, message, qos }) => {
    const [result] = await pool.query(
        "INSERT INTO messages (device_id, topic, message, qos) VALUES (?, ?, ?, ?)",
        [deviceId, topic, JSON.stringify(message), qos]
    );

    messageEmitter.emit("newMessage", {
        id: result.insertId,
        device_id: deviceId,
        topic,
        message: JSON.stringify(message),
        qos,
        created_at: new Date(),
    });

    return result.insertId;
};

module.exports = { messageEmitter, storeMessage };
