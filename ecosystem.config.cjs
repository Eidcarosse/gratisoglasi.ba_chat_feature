// PM2 process config. MVP runs a SINGLE instance on one droplet (doc §9).
// LATER (§10 "outgrowing one core"): switch `instances` to 'max' and `exec_mode`
// to 'cluster' — but only AFTER the Redis socket adapter is enabled in
// loaders/socket.js, otherwise cross-process socket emits won't fan out.
module.exports = {
  apps: [
    {
      name: 'marketplace-chat',
      script: 'src/server.js',
      instances: 1, // → 'max' once @socket.io/redis-adapter is wired
      exec_mode: 'fork', // → 'cluster' alongside the change above
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
