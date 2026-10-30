const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const supertest = require('supertest');
const mysql = require('mysql2/promise');
const { createApp } = require('../src/app');

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3307),
  user: process.env.DB_USER || 'webhooks', password: process.env.DB_PASSWORD || 'webhooks',
  database: process.env.DB_NAME || 'webhooks_test', connectionLimit: 10, multipleStatements: true
};
const hasTestDb = process.env.RUN_DB_TESTS === '1';

describe('Reliable webhook API (MySQL integration)', { skip: !hasTestDb }, () => {
  let pool;
  let app;
  let mockServer;
  let mockUrl;
  let handler;
  const retry = { timeoutMs: 80, maxAttempts: 3, retryDelayMs: 0 };

  before(async () => {
    pool = mysql.createPool(dbConfig);
    let lastError;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      try {
        await pool.query('SELECT 1');
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (lastError) throw new Error(`MySQL did not become ready: ${lastError.message}`);
    await pool.query(fs.readFileSync(path.join(__dirname, '../sql/schema.sql'), 'utf8'));
    mockServer = http.createServer((req, res) => handler(req, res));
    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    mockUrl = `http://127.0.0.1:${mockServer.address().port}/hook`;
    app = createApp({ pool, deliveryConfig: retry });
  });
  after(async () => {
    if (mockServer) await new Promise((resolve) => mockServer.close(resolve));
    if (pool) await pool.end();
  });
  beforeEach(async () => {
    handler = (_req, res) => { res.writeHead(204); res.end(); };
    await pool.query('SET FOREIGN_KEY_CHECKS=0');
    await pool.query('TRUNCATE TABLE deliveries');
    await pool.query('TRUNCATE TABLE endpoint_subscriptions');
    await pool.query('TRUNCATE TABLE events');
    await pool.query('TRUNCATE TABLE webhook_endpoints');
    await pool.query('SET FOREIGN_KEY_CHECKS=1');
  });

  it('registers a valid endpoint and rejects malformed fields', async () => {
    const good = await supertest(app).post('/webhook-endpoints').send({ url: mockUrl, events: ['order.created'] });
    assert.equal(good.status, 201);
    assert.equal(good.body.url, mockUrl);
    for (const body of [
      { url: 'file:///tmp/x', events: ['order.created'] },
      { url: mockUrl, events: ['made.up'] },
      { events: ['order.created'] }
    ]) {
      const bad = await supertest(app).post('/webhook-endpoints').send(body);
      assert.equal(bad.status, 400);
      assert.ok(bad.body.fields);
    }
  });

  it('accepts, delivers and returns delivery status', async () => {
    await supertest(app).post('/webhook-endpoints').send({ url: mockUrl, events: ['order.created'] }).expect(201);
    const response = await supertest(app).post('/events').send({ eventId: 'evt_success', eventType: 'order.created', payload: { orderId: 'o1' } }).expect(202);
    assert.equal(response.body.status, 'accepted');
    const status = await supertest(app).get('/events/evt_success').expect(200);
    assert.equal(status.body.deliveries[0].status, 'succeeded');
    assert.equal(status.body.deliveries[0].attemptCount, 1);
  });

  it('rejects sequential and concurrent duplicate event IDs', async () => {
    const payload = { eventId: 'evt_duplicate', eventType: 'order.created', payload: {} };
    assert.equal((await supertest(app).post('/events').send(payload)).status, 202);
    assert.equal((await supertest(app).post('/events').send(payload)).status, 409);

    const concurrent = { ...payload, eventId: 'evt_concurrent' };
    const responses = await Promise.all(Array.from({ length: 8 }, () => supertest(app).post('/events').send(concurrent)));
    assert.equal(responses.filter((r) => r.status === 202).length, 1);
    assert.equal(responses.filter((r) => r.status === 409).length, 7);
    const [rows] = await pool.execute('SELECT COUNT(*) AS n FROM events WHERE event_id = ?', [concurrent.eventId]);
    assert.equal(rows[0].n, 1);
  });

  it('retries failed endpoints only to the configured attempt limit', async () => {
    let calls = 0;
    handler = (_req, res) => { calls += 1; res.writeHead(503); res.end('unavailable'); };
    await supertest(app).post('/webhook-endpoints').send({ url: mockUrl, events: ['order.created'] });
    await supertest(app).post('/events').send({ eventId: 'evt_fail', eventType: 'order.created', payload: {} }).expect(202);
    const { body } = await supertest(app).get('/events/evt_fail');
    assert.equal(calls, 3);
    assert.equal(body.deliveries[0].attemptCount, 3);
    assert.equal(body.deliveries[0].status, 'failed');
  });

  it('marks a slow endpoint failed after a timeout', async () => {
    handler = (_req, res) => setTimeout(() => { res.writeHead(204); res.end(); }, 250);
    await supertest(app).post('/webhook-endpoints').send({ url: mockUrl, events: ['order.created'] });
    await supertest(app).post('/events').send({ eventId: 'evt_slow', eventType: 'order.created', payload: {} }).expect(202);
    const { body } = await supertest(app).get('/events/evt_slow');
    assert.equal(body.deliveries[0].status, 'failed');
    assert.equal(body.deliveries[0].attemptCount, 3);
    assert.match(body.deliveries[0].lastError, /timed out/i);
  });

  it('delivers to a healthy endpoint even when another endpoint is slow', async () => {
    let fastEndpointCalled = false;
    handler = (req, res) => {
      if (req.url.endsWith('/slow')) {
        setTimeout(() => { res.writeHead(204); res.end(); }, 250);
        return;
      }
      if (req.url.endsWith('/fast')) {
        fastEndpointCalled = true;
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(404).end();
    };
    await supertest(app).post('/webhook-endpoints').send({ url: `${mockUrl}/slow`, events: ['order.created'] }).expect(201);
    await supertest(app).post('/webhook-endpoints').send({ url: `${mockUrl}/fast`, events: ['order.created'] }).expect(201);
    await supertest(app).post('/events').send({ eventId: 'evt_isolated', eventType: 'order.created', payload: {} }).expect(202);
    const { body } = await supertest(app).get('/events/evt_isolated').expect(200);
    assert.equal(fastEndpointCalled, true);
    assert.equal(body.deliveries.length, 2);
    assert.equal(body.deliveries[0].status, 'failed');
    assert.equal(body.deliveries[1].status, 'succeeded');
    assert.equal(body.deliveries[1].attemptCount, 1);
  });

  it('validates events and returns 404 for unknown status IDs', async () => {
    const bad = await supertest(app).post('/events').send({ eventId: 'x', eventType: 'unknown', payload: [] });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fields.eventType && bad.body.fields.payload);
    await supertest(app).get('/events/missing').expect(404);
  });
});
