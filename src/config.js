require('dotenv').config();

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function nonNegativeInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function maxAttempts(value) {
  const parsed = positiveInteger(value, 3, 'DELIVERY_MAX_ATTEMPTS');
  if (parsed > 3) throw new Error('DELIVERY_MAX_ATTEMPTS cannot exceed 3');
  return parsed;
}

module.exports = {
  port: positiveInteger(process.env.PORT, 3000, 'PORT'),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: positiveInteger(process.env.DB_PORT, 3307, 'DB_PORT'),
    user: process.env.DB_USER || 'webhooks',
    password: process.env.DB_PASSWORD || 'webhooks',
    database: process.env.DB_NAME || 'webhooks',
    connectionLimit: positiveInteger(process.env.DB_POOL_SIZE, 10, 'DB_POOL_SIZE'),
    charset: 'utf8mb4'
  },
  delivery: {
    timeoutMs: positiveInteger(process.env.DELIVERY_TIMEOUT_MS, 5000, 'DELIVERY_TIMEOUT_MS'),
    maxAttempts: maxAttempts(process.env.DELIVERY_MAX_ATTEMPTS),
    retryDelayMs: nonNegativeInteger(process.env.DELIVERY_RETRY_DELAY_MS, 250, 'DELIVERY_RETRY_DELAY_MS')
  }
};
