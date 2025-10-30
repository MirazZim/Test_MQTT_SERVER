const express = require("express");
const morgan = require("morgan");
const cors = require("cors");

const setupMiddleware = (app) => {
    app.use(
        cors({
            origin: ["http://192.168.88.36:5173", "http://localhost:5173", "http://localhost:3000", "http://192.168.88.36:3000", "http://localhost:5000"],
            credentials: true,
            methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
            allowedHeaders: ["Content-Type", "Authorization"],
        })
    );

    app.use(morgan("dev"));
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json({ limit: "50mb", extended: true }));
};

module.exports = { setupMiddleware };
