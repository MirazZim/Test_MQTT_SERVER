module.exports = {
    apps: [{
        name: 'MQTT_Server',
        script: './src/server.js',
        instances: 8, // Auto-detect CPU cores (8 cores = 8 workers)
        exec_mode: 'cluster',
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        env_production: {
            NODE_ENV: 'production',
            PORT: 3001
        },
        env_development: {
            NODE_ENV: 'development',
            PORT: 3001
        },
        error_file: './logs/err.log',
        out_file: './logs/out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,
        min_uptime: '10s', // Consider app crashed if stops within 10s
        max_restarts: 10,
        restart_delay: 1000,

        // Advanced settings
        kill_timeout: 5000, // Wait 5s before force kill
        listen_timeout: 10000, // Wait 10s for app to be ready
        wait_ready: false, // Set to true if implementing health check signals

        // Cluster-specific
        instance_var: 'INSTANCE_ID' // Each worker gets unique INSTANCE_ID env var
    }]
};
