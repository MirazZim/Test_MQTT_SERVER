const bcrypt = require('bcryptjs');
const { promisify } = require('util');

// Reduce bcrypt rounds from 10 → 8 for 2x faster hashing
// Still secure (2^8 = 256 iterations minimum)
const SALT_ROUNDS = 8;

// Use async versions to prevent event loop blocking
const hashPassword = async (password) => {
    return bcrypt.hash(password, SALT_ROUNDS);
};

const comparePassword = async (password, hash) => {
    return bcrypt.compare(password, hash);
};

module.exports = { hashPassword, comparePassword };
