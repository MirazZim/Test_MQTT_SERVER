const express = require("express");
const { loginUser } = require("../main/auth/auth-login");
const { registerUser } = require("../main/auth/auth-register");
const { logoutUser } = require("../main/auth/auth-logout");
const authenticate = require("../middleware/auth.js");
const { authLimiter } = require("../middleware/rateLimiter.js");



const authRouter = express.Router();

authRouter.post("/auth/login", async (req, res) => {
    loginUser(req.body)
        .then((data) => {
            return res.status(200).send({
                status: data.status,
                message: data.message,
                token: data.token,
                user: data.user,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

authRouter.post("/auth/register", async (req, res) => {
    registerUser(req.body)
        .then((data) => {
            return res.status(201).send({
                status: data.status,
                message: data.message,
                token: data.token,
                user: data.user,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});

authRouter.post("/auth/logout", authenticate.adminOrUser, async (req, res) => {
    logoutUser(req.user.id)
        .then((data) => {
            return res.status(200).send({
                status: data.status,
                message: data.message,
            });
        })
        .catch((error) => {
            return res.status(400).send({
                status: error.status,
                message: error.message,
            });
        });
});


module.exports = authRouter;