const express = require("express");
const router = express.Router();
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");

// Camera configuration
const CAMERA_URL = "http://192.168.88.42:8080/photo.jpg";
const SAVE_DIR = path.join(__dirname, "../../images");

// Ensure save directory exists
if (!fs.existsSync(SAVE_DIR)) {
    fs.mkdirSync(SAVE_DIR, { recursive: true });
}

// Download image from URL helper function
async function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith("https") ? https : http;

        protocol
            .get(url, (response) => {
                const code = response.statusCode ?? 0;

                if (code >= 400) {
                    return reject(new Error(response.statusMessage));
                }

                // Handle redirects
                if (code > 300 && code < 400 && response.headers.location) {
                    return downloadImage(response.headers.location, filepath)
                        .then(resolve)
                        .catch(reject);
                }

                // Save the file to disk
                const fileWriter = fs
                    .createWriteStream(filepath)
                    .on("finish", () => {
                        resolve({
                            filepath,
                            contentType: response.headers["content-type"],
                        });
                    })
                    .on("error", reject);

                response.pipe(fileWriter);
            })
            .on("error", (error) => {
                reject(error);
            });
    });
}

// Capture image endpoint
router.get("/capture", async (req, res) => {
    try {
        const filename = `snapshot_${Date.now()}.jpg`;
        const filepath = path.join(SAVE_DIR, filename);

        await downloadImage(CAMERA_URL, filepath);

        console.log(`✅ Image captured: ${filename}`);

        res.json({
            success: true,
            file: filename,
            timestamp: Date.now(),
            path: filepath,
        });
    } catch (error) {
        console.error("❌ Camera capture error:", error);
        res.status(503).json({
            success: false,
            error: "Camera connection failed",
            details: error.message,
        });
    }
});

// Get list of captured images
router.get("/images", (req, res) => {
    try {
        const files = fs
            .readdirSync(SAVE_DIR)
            .filter((file) => file.endsWith(".jpg"))
            .map((file) => ({
                filename: file,
                path: path.join(SAVE_DIR, file),
                created: fs.statSync(path.join(SAVE_DIR, file)).birthtime,
            }))
            .sort((a, b) => b.created - a.created);

        res.json({
            success: true,
            count: files.length,
            images: files,
        });
    } catch (error) {
        console.error("❌ Error listing images:", error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Serve captured image
router.get("/images/:filename", (req, res) => {
    try {
        const filepath = path.join(SAVE_DIR, req.params.filename);

        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                success: false,
                error: "Image not found",
            });
        }

        res.sendFile(filepath);
    } catch (error) {
        console.error("❌ Error serving image:", error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Delete image
router.delete("/images/:filename", (req, res) => {
    try {
        const filepath = path.join(SAVE_DIR, req.params.filename);

        if (!fs.existsSync(filepath)) {
            return res.status(404).json({
                success: false,
                error: "Image not found",
            });
        }

        fs.unlinkSync(filepath);

        res.json({
            success: true,
            message: "Image deleted successfully",
        });
    } catch (error) {
        console.error("❌ Error deleting image:", error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

// Proxy endpoint for live camera stream (optional)
router.get("/stream", (req, res) => {
    const streamUrl = "http://192.168.88.42:8080/video";

    http
        .get(streamUrl, (response) => {
            res.writeHead(200, {
                "Content-Type": response.headers["content-type"],
                "Transfer-Encoding": "chunked",
            });
            response.pipe(res);
        })
        .on("error", (error) => {
            console.error("❌ Stream error:", error);
            res.status(503).json({
                success: false,
                error: "Camera stream unavailable",
            });
        });
});

module.exports = router;
