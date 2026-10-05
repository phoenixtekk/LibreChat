/**
 * pm2 process definitions for the Analytikul-One local dev stack.
 *
 * Runs the native backend + frontend as persistent, daemonized services so they
 * survive closing every terminal window (and, with `pm2 save` + a Windows startup
 * hook, a reboot). This replaces `npm run backend:dev` / `frontend:dev` in
 * foreground terminals.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save            # persist the process list
 *   pm2 logs            # tail both
 *   pm2 restart analytikul-backend
 *
 * The Docker infra (mongo/meili/redis/pgvector/rag_api/hermes-adapter/services)
 * is managed separately by docker compose and already persists as containers.
 */
const path = require('path');
const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'analytikul-backend',
      // Plain node (pm2 supplies watch/restart, so no nodemon) — Express API on :3080.
      script: path.join('api', 'server', 'index.js'),
      cwd: root,
      interpreter: 'node',
      env: { NODE_ENV: 'development' },
      // Hot-reload on real backend edits only. Crucially, node_modules + client are
      // ignored so Vite's dependency optimizer (writing under client/node_modules/.vite)
      // can't knock the backend into a restart loop — the bug that took it down earlier.
      watch: ['api', 'packages/api/dist'],
      ignore_watch: ['node_modules', 'client', 'uploads', 'logs', 'data', '.git', 'images', 'e2e'],
      watch_delay: 1000,
      autorestart: true,
      max_restarts: 30,
      restart_delay: 1500,
      time: true,
    },
    {
      name: 'analytikul-frontend',
      // Vite dev server on :3090 (its own HMR — no pm2 watch needed). vite is hoisted
      // to the repo-root node_modules; run it with cwd=client so it finds the client config.
      script: path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      cwd: path.join(root, 'client'),
      interpreter: 'node',
      env: { NODE_ENV: 'development' },
      watch: false,
      autorestart: true,
      max_restarts: 30,
      time: true,
    },
  ],
};
