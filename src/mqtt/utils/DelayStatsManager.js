// src/mqtt/utils/DelayStatsManager.js
const { Mutex } = require("async-mutex");

class DelayStatsManager {
    constructor(maxHistory = 100) {
        this.delayStats = {
            server_processing: [],
            socket_emission: [],
            total_e2e: []
        };
        this.maxHistory = maxHistory;
        this.mutex = new Mutex();
    }

    async updateStats(delays) {
        const release = await this.mutex.acquire();
        try {
            for (const [key, value] of Object.entries(delays)) {
                if (!this.delayStats[key]) this.delayStats[key] = [];
                this.delayStats[key].push(value);

                if (this.delayStats[key].length > this.maxHistory) {
                    this.delayStats[key].splice(0, this.delayStats[key].length - this.maxHistory);
                }
            }
        } finally {
            release();
        }
    }

    calculateStats() {
        const toStats = (arr) => arr && arr.length ? {
            avg: Math.round(((arr.reduce((a, b) => a + b, 0) / arr.length) * 100)) / 100,
            min: Math.min(...arr),
            max: Math.max(...arr),
            latest: arr[arr.length - 1],
            samples: arr.length
        } : { avg: 0, min: 0, max: 0, latest: 0, samples: 0 };

        return {
            server_processing: toStats(this.delayStats.server_processing),
            socket_emission: toStats(this.delayStats.socket_emission),
            total_e2e: toStats(this.delayStats.total_e2e)
        };
    }
}

module.exports = DelayStatsManager;
