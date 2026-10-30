const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function deliverToEndpoint({ pool, eventPk, endpoint, event, config, fetchImpl = fetch, sleepImpl = sleep }) {
  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    let responseStatus = null;
    let error = null;
    let succeeded = false;
    try {
      const response = await fetchImpl(endpoint.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(config.timeoutMs)
      });
      responseStatus = response.status;
      succeeded = response.status >= 200 && response.status < 300;
      if (!succeeded) error = `Endpoint returned HTTP ${response.status}`;
      if (response.body) await response.body.cancel().catch(() => {});
    } catch (err) {
      error = err?.name === 'TimeoutError' || err?.name === 'AbortError'
        ? `Request timed out after ${config.timeoutMs} ms`
        : String(err?.message || 'Network error').slice(0, 2000);
    }

    const final = succeeded || attempt === config.maxAttempts;
    await pool.execute(
      `UPDATE deliveries SET status = ?, attempt_count = ?, last_response_status = ?, last_error = ?,
       completed_at = ${final ? 'CURRENT_TIMESTAMP(3)' : 'NULL'}
       WHERE event_pk = ? AND endpoint_id = ?`,
      [succeeded ? 'succeeded' : (final ? 'failed' : 'pending'), attempt, responseStatus, error, eventPk, endpoint.id]
    );
    if (succeeded || final) return;
    if (config.retryDelayMs > 0) await sleepImpl(config.retryDelayMs);
  }
}

module.exports = { deliverToEndpoint };
