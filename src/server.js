const { createApp } = require('./app');
const { createPool } = require('./db');
const config = require('./config');

const pool = createPool();
const app = createApp({ pool, deliveryConfig: config.delivery });
const server = app.listen(config.port, () => console.log(`Webhook API listening on port ${config.port}`));

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

