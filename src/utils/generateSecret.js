const crypto = require('crypto');

module.exports = () => {
  return crypto.randomBytes(32).toString('hex');
};