const Admin = require("../../models/admin");

const updateUserAdmin = async (req, res) => {
    const { id } = req.params;
    const { username, role, email, is_active } = req.body;

    console.log(`🔵 [Controller] Updating user ${id} with:`, req.body);

    try {
        // Validate that at least one field is provided
        if (!username && !role && email === undefined && is_active === undefined) {
            return res.status(400).json({
                error: 'At least one field must be provided to update'
            });
        }

        // Build update data object with only provided fields
        const updateData = {};
        if (username !== undefined) updateData.username = username;
        if (role !== undefined) updateData.role = role;
        if (email !== undefined) updateData.email = email;
        if (is_active !== undefined) updateData.is_active = is_active;

        console.log(`📝 [Controller] Final update data:`, updateData);

        await Admin.updateUser(id, updateData);

        res.json({
            message: 'User updated successfully',
            userId: id
        });
    } catch (err) {
        console.error(`❌ [Controller] Error updating user:`, err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = { updateUserAdmin };
