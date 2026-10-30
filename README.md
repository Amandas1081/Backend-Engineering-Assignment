# Reliable Webhook Delivery API

A small Express and MySQL API that stores webhook subscriptions and events, then delivers each accepted event synchronously in the request flow. It has no worker, queue, scheduler, or external test destinations.

## Requirements

- Node.js 20 or newer
- Docker Compose (or a reachable MySQL 8 database)

## Run locally

1. Start MySQL: `docker compose up -d mysql` (the initial schema is loaded into a new volume).
2. Copy `.env.example` to `.env` and adjust values if needed.
3. Install packages: `npm install`.
4. Start the API: `npm start`.

The API listens on port 3000 by default. `GET /health` is a simple liveness endpoint.

## Quick local demo

Start `npm run demo:receiver` in one terminal and `npm start` in another. In a third terminal, register the local receiver and submit an event:

```sh
curl -i http://localhost:3000/webhook-endpoints \
  -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:4000/webhook","events":["order.created"]}'

curl -i http://localhost:3000/events \
  -H 'content-type: application/json' \
  -d '{"eventId":"evt_demo_1","eventType":"order.created","payload":{"orderId":"order_123","amount":1500}}'

curl -i http://localhost:3000/events/evt_demo_1
```

The receiver terminal prints the delivered event JSON. To demonstrate idempotency, send the second request again with the same `eventId`; it returns `409` and does not deliver a second time. The demo receiver binds only to `127.0.0.1` and is for local development.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | API listen port |
| `DB_HOST` | `127.0.0.1` | MySQL host |
| `DB_PORT` | `3307` | MySQL host port in the Compose setup |
| `DB_USER` | `webhooks` | MySQL user |
| `DB_PASSWORD` | `webhooks` | MySQL password |
| `DB_NAME` | `webhooks` | MySQL database |
| `DB_POOL_SIZE` | `10` | Maximum pooled MySQL connections |
| `DELIVERY_TIMEOUT_MS` | `5000` | Per-attempt network timeout |
| `DELIVERY_MAX_ATTEMPTS` | `3` | Total attempts, including the initial request |
| `DELIVERY_RETRY_DELAY_MS` | `250` | Fixed pause between failed attempts; set to `0` for tests |

## API

### `POST /webhook-endpoints`

```json
{"url":"https://example.com/webhook","events":["order.created","order.updated"]}
```

Returns `201` with the generated endpoint ID. Supported types are `order.created`, `order.updated`, `order.cancelled`, `payment.succeeded`, and `payment.failed`. Invalid fields return `400` with a `fields` object.

### `POST /events`

```json
{"eventId":"evt_1001","eventType":"order.created","payload":{"orderId":"order_123","amount":1500}}
```

Returns `202` after all subscribed endpoints have reached a final delivery state. Individual failed deliveries do not turn an accepted event into an HTTP failure; inspect `GET /events/:eventId` for their outcomes. A repeated `eventId` returns `409` and does not initiate another delivery round.

### `GET /events/:eventId`

Returns the stored event and per-endpoint delivery status, attempt count, last response status/error, and timestamps. Returns `404` when the event is unknown.

## Delivery and persistence decisions

Each endpoint is delivered independently with `Promise.allSettled`. Native `fetch` is bounded by `AbortSignal.timeout`; only a 2xx response succeeds. Other HTTP statuses, network errors, and timeouts are recorded and retried up to the configured maximum. Retries use a fixed configurable delay: it is easy to reason about, bounded, and straightforward to set to zero in tests.

The event ID has a database unique key. The API inserts the event and its delivery rows in one transaction; concurrent requests race on that key, so exactly one commits and the other receives `409`. The event type subscription index supports endpoint lookup. Endpoint subscriptions and event/delivery links use foreign keys, and each event/endpoint pair has one delivery row.

## Tests

The integration suite uses a local HTTP mock server and MySQL. It never posts to real external URLs. Its default database is `webhooks_test`, separate from the app's `webhooks` database.

```sh
docker compose up -d mysql
npm install
RUN_DB_TESTS=1 npm test
```

The test suite truncates tables in `DB_NAME` (default `webhooks_test`). Keep that database disposable. The Compose setup creates it separately from the app database. Tests cover registration and validation, successful delivery, sequential and concurrent duplicates, bounded retries, timeouts, and status lookup.

## Schema and limitations

`sql/schema.sql` creates the required tables and indexes from a clean database. This is a focused assignment implementation: it does not include authentication, webhook signatures, endpoint management/deletion, pagination, rate limiting, or SSRF protection.

Delivery happens synchronously in the API request, as required. If the process crashes after the event transaction commits but before all HTTP attempts finish, some deliveries can remain `pending`; there is deliberately no recovery worker or scheduler. A client retrying the same event ID receives `409` and does not restart deliveries. A durable recovery mechanism would require an explicit change to the assignment's no-worker constraint.
