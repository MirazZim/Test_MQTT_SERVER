// const db = require('../config/db');

// class Message {
//   static async store(deviceId, topic, message, qos) {
//     await db.query(
//       'INSERT INTO messages (device_id, topic, message, qos) VALUES (?, ?, ?, ?)',
//       [deviceId, topic, JSON.stringify(message), qos]
//     );
//   }
// }

// module.exports = Message;

const db = require('../config/db');

const store = async (deviceId, topic, message, qos) => {
  await db.query(
    'INSERT INTO messages (device_id, topic, message, qos) VALUES (?, ?, ?, ?)',
    [deviceId, topic, JSON.stringify(message), qos]
  );
};

module.exports = {
  store
};
