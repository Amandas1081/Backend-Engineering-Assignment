const express = require('express');
const { EVENT_TYPES, validateEndpoint, validateEvent } = require('./validation');
const { deliverToEndpoint } = require('./deliver');

function createApp({ pool, deliveryConfig, fetchImpl, sleepImpl }) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/webhook-endpoints', async (req, res, next) => {
    const errors = validateEndpoint(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Invalid request', fields: errors });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute('INSERT INTO webhook_endpoints (url) VALUES (?)', [req.body.url]);
      const endpointId = result.insertId;
      for (const eventType of new Set(req.body.events)) {
        await connection.execute('INSERT INTO endpoint_subscriptions (endpoint_id, event_type) VALUES (?, ?)', [endpointId, eventType]);
      }
      await connection.commit();
      return res.status(201).json({ id: endpointId, url: req.body.url, events: [...new Set(req.body.events)] });
    } catch (error) {
      await connection.rollback();
      return next(error);
    } finally { connection.release(); }
  });

  app.post('/events', async (req, res, next) => {
    const errors = validateEvent(req.body);
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Invalid request', fields: errors });
    let connection;
    let eventPk;
    let endpoints;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [insert] = await connection.execute(
        'INSERT INTO events (event_id, event_type, payload) VALUES (?, ?, ?)',
        [req.body.eventId, req.body.eventType, JSON.stringify(req.body.payload)]
      );
      eventPk = insert.insertId;
      const [rows] = await connection.execute(
        `SELECT e.id, e.url FROM webhook_endpoints e
         INNER JOIN endpoint_subscriptions s ON s.endpoint_id = e.id
         WHERE s.event_type = ? ORDER BY e.id`, [req.body.eventType]
      );
      endpoints = rows;
      for (const endpoint of endpoints) {
        await connection.execute(
          'INSERT INTO deliveries (event_pk, endpoint_id) VALUES (?, ?)', [eventPk, endpoint.id]
        );
      }
      await connection.commit();
    } catch (error) {
      if (connection) {
        await connection.rollback().catch(() => {});
      }
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'eventId has already been accepted', eventId: req.body.eventId });
      }
      return next(error);
    } finally {
      if (connection) connection.release();
    }

    const event = { eventId: req.body.eventId, eventType: req.body.eventType, payload: req.body.payload };
    // Isolate every destination: one endpoint's error must not block another delivery.
    await Promise.allSettled(endpoints.map((endpoint) => deliverToEndpoint({
      pool, eventPk, endpoint, event, config: deliveryConfig, fetchImpl, sleepImpl
    })));
    return res.status(202).json({ eventId: event.eventId, eventType: event.eventType, status: 'accepted' });
  });

  app.get('/events/:eventId', async (req, res, next) => {
    try {
      const [events] = await pool.execute('SELECT id, event_id, event_type, payload, created_at FROM events WHERE event_id = ?', [req.params.eventId]);
      if (!events.length) return res.status(404).json({ error: 'Event not found' });
      const event = events[0];
      const [deliveries] = await pool.execute(
        `SELECT d.endpoint_id, e.url, d.status, d.attempt_count, d.last_response_status, d.last_error,
         d.created_at, d.updated_at, d.completed_at
         FROM deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
         WHERE d.event_pk = ? ORDER BY d.endpoint_id`, [event.id]
      );
      return res.json({
        event: { eventId: event.event_id, eventType: event.event_type, payload: event.payload, createdAt: event.created_at },
        deliveries: deliveries.map((d) => ({
          endpointId: d.endpoint_id, url: d.url, status: d.status, attemptCount: d.attempt_count,
          lastResponseStatus: d.last_response_status, lastError: d.last_error,
          createdAt: d.created_at, updatedAt: d.updated_at, completedAt: d.completed_at
        }))
      });
    } catch (error) { return next(error); }
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Invalid JSON body' });
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
