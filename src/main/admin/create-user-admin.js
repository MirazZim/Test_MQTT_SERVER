const Admin = require("../../models/admin");
const bcrypt = require("bcrypt");

const createUserAdmin = async (userData) => {
    try {
        const { username, password, role = 'user', desired_temperature = 22.0 } = userData;

        if (!username || !password) {
            return {
                status: "error",
                message: "Username and password are required"
            };
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        const userCreateData = {
            username,
            password: hashedPassword,
            role,
            desired_temperature
        };

        const result = await Admin.createUser(userCreateData);

        return {
            status: "success",
            message: "User created successfully",
            userId: result.insertId
        };

    } catch (error) {
        console.error("Error creating user:", error);

        if (error.code === 'ER_DUP_ENTRY') {
            return {
                status: "error",
                message: "Username already exists"
            };
        }

        return {
            status: "error",
            message: error.message || "Failed to create user"
        };
    }
};

module.exports = { createUserAdmin };
