const rateLimit = require('express-rate-limit');

// Global rate limiter (all endpoints)
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per IP per 15 min
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip successful requests from counting
    skipSuccessfulRequests: false,
    // Skip failed requests from counting
    skipFailedRequests: false
});

// Auth endpoints rate limiter (stricter)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 login/register attempts per IP per 15 min
    message: { error: 'Too many authentication attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { globalLimiter, authLimiter };
