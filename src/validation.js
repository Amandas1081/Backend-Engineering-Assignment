const EVENT_TYPES = Object.freeze([
  'order.created', 'order.updated', 'order.cancelled',
  'payment.succeeded', 'payment.failed'
]);
const eventTypeSet = new Set(EVENT_TYPES);

function validateEndpoint(body) {
  const errors = {};
  if (typeof body?.url !== 'string' || !body.url.trim()) {
    errors.url = 'must be a non-empty absolute HTTP or HTTPS URL';
  } else {
    try {
      const url = new URL(body.url);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('invalid');
    } catch {
      errors.url = 'must be a valid absolute HTTP or HTTPS URL';
    }
  }
  if (!Array.isArray(body?.events) || body.events.length === 0) {
    errors.events = 'must be a non-empty array';
  } else {
    const bad = body.events.find((item) => !eventTypeSet.has(item));
    if (bad !== undefined) errors.events = `contains unsupported event type: ${String(bad)}`;
  }
  return errors;
}

function validateEvent(body) {
  const errors = {};
  if (typeof body?.eventId !== 'string' || !body.eventId.trim()) errors.eventId = 'is required and must be a non-empty string';
  if (!eventTypeSet.has(body?.eventType)) errors.eventType = `must be one of: ${EVENT_TYPES.join(', ')}`;
  if (!body || typeof body.payload !== 'object' || body.payload === null || Array.isArray(body.payload)) {
    errors.payload = 'is required and must be a JSON object';
  }
  return errors;
}

module.exports = { EVENT_TYPES, validateEndpoint, validateEvent };
