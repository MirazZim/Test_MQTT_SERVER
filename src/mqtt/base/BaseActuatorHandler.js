const { Mutex } = require('async-mutex');
const pool = require('../../config/db');

class BaseActuatorHandler {
    constructor(io, actuatorData, activeUsers, actuatorDataMutex) {
        this.io = io;
        this.actuatorData = actuatorData;
        this.activeUsers = activeUsers;
        this.actuatorDataMutex = actuatorDataMutex;
    }

    async updateActuatorState(actuatorTypeCode, state, message) {
        for (const [userId, rooms] of this.activeUsers) {
            for (const roomCode of rooms) {
                try {
                    const [roomRows] = await pool.execute(
                        'SELECT id FROM rooms WHERE user_id = ? AND room_code = ? AND is_active = 1',
                        [userId, roomCode]
                    );

                    if (roomRows.length === 0) continue;
                    const roomId = roomRows[0].id;

                    await pool.execute(
                        `INSERT INTO actuator_states 
                         (user_id, room_id, actuator_type, status, message, state, timestamp)
                         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
                        [userId, roomId, actuatorTypeCode, state, message, state === 'ON' ? 1 : 0]
                    );

                    console.log(`✅ [BaseActuatorHandler] Updated actuator_states: ${actuatorTypeCode} = ${state}`);
                } catch (error) {
                    console.error(`❌ [BaseActuatorHandler] Error:`, error.message);
                }
            }
        }
    }

    updateCache(key, value) {
        this.actuatorData[key] = value;
        console.log(`🔄 [BaseActuatorHandler] Cache updated: ${key} = ${value}`);
    }
}

module.exports = BaseActuatorHandler;