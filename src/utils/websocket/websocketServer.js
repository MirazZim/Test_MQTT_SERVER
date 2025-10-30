// utils/websocket/websocketServer.js
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const pool = require("../../config/db");
const url = require("url");

const createWebSocketServer = (server, messageEmitter) => {
    // Use noServer: true to prevent automatic upgrade handling
    const wss = new WebSocket.Server({
        noServer: true,  // ✅ This prevents conflicts
        clientTracking: true,
    });

    // Manual upgrade handling with path routing
    server.on('upgrade', (req, socket, head) => {
        const { pathname } = url.parse(req.url || '/');

        // Only handle WebSocket requests to /ws path
        if (pathname === '/ws') {
            // Verify JWT token
            const token = new URL(req.url, "http://localhost").searchParams.get("token");
            if (!token) {
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }

            jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
                if (err) {
                    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                    socket.destroy();
                    return;
                }

                // Upgrade to WebSocket
                wss.handleUpgrade(req, socket, head, (ws) => {
                    req.user = decoded;
                    wss.emit('connection', ws, req);
                });
            });
        }
        // Let Socket.IO handle /socket.io/ paths automatically
        // Other paths get destroyed
        else if (!pathname.startsWith('/socket.io/')) {
            socket.destroy();
        }
    });

    // Rest of your WebSocket connection logic remains the same
    wss.on("connection", (ws, req) => {
        const deviceId = new URL(req.url, "http://localhost").searchParams.get("device");
        const user = req.user;

        pool.query(`SELECT * FROM user_devices WHERE user_id = ? AND device_id = ?`, [
            user.id,
            deviceId,
        ])
            .then(([rows]) => {
                if (rows.length === 0) return ws.close(1008, "Device access denied");

                pool.query(
                    `SELECT * FROM messages WHERE device_id = ? ORDER BY created_at DESC LIMIT 100`,
                    [deviceId]
                )
                    .then(([rows]) =>
                        ws.send(
                            JSON.stringify(
                                rows.map((row) => ({
                                    ...row,
                                    message: JSON.parse(row.message || "{}"),
                                }))
                            )
                        )
                    );

                const listener = (message) => {
                    if (message.device_id === deviceId) {
                        ws.send(
                            JSON.stringify([
                                {
                                    ...message,
                                    message: JSON.parse(message.message || "{}"),
                                },
                            ])
                        );
                    }
                };

                messageEmitter.on("newMessage", listener);
                ws.on("close", () => messageEmitter.off("newMessage", listener));
                ws.on("error", () => messageEmitter.off("newMessage", listener));
            });
    });

    return wss;
};

module.exports = { createWebSocketServer };
