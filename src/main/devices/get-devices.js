const { getAll } = require("../../models/Device");
const pool = require("../../config/db");

const fetchDevices = async (userRole, userId) => {
    try {
        let devices;

        if (userRole === "admin") {
            devices = await getAll();
        } else {
            const [rows] = await pool.query(
                `SELECT d.id, d.name 
                 FROM devices d
                 JOIN user_devices ud ON d.id = ud.device_id
                 WHERE ud.user_id = ?`,
                [userId]
            );
            devices = rows;
        }

        return devices;
    } catch (error) {
        throw error;
    }
};

const getDevices = async (userData) => {
    const { role, id } = userData;

    try {
        const devices = await fetchDevices(role, id);

        return Promise.resolve({
            status: "success",
            message: "Devices retrieved successfully",
            devices: devices,
        });

    } catch (err) {
        console.error("Error getting devices:", err);
        return Promise.reject({
            status: "failed",
            message: err.message || "An error occurred while retrieving devices",
        });
    }
};

module.exports = { getDevices };
