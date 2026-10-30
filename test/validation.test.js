const { it } = require('node:test');
const assert = require('node:assert/strict');
const { validateEndpoint, validateEvent, EVENT_TYPES } = require('../src/validation');

it('accepts supported absolute HTTP(S) endpoints and rejects bad fields', () => {
  assert.deepEqual(validateEndpoint({ url: 'https://hooks.example.test/a', events: ['order.created'] }), {});
  assert.ok(validateEndpoint({ url: 'ftp://hooks.example.test', events: ['order.created'] }).url);
  assert.ok(validateEndpoint({ url: 'https://hooks.example.test', events: [] }).events);
  assert.ok(validateEndpoint({ url: 'https://hooks.example.test', events: ['unknown'] }).events);
});

it('requires a non-empty event ID, supported type, and object payload', () => {
  assert.deepEqual(validateEvent({ eventId: 'evt_1', eventType: EVENT_TYPES[0], payload: {} }), {});
  const errors = validateEvent({ eventId: '', eventType: 'unknown', payload: [] });
  assert.deepEqual(Object.keys(errors).sort(), ['eventId', 'eventType', 'payload']);
});
