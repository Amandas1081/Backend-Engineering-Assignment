CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  url VARCHAR(2048) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS endpoint_subscriptions (
  endpoint_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (endpoint_id, event_type),
  KEY idx_subscriptions_event_type_endpoint (event_type, endpoint_id),
  CONSTRAINT fk_subscription_endpoint FOREIGN KEY (endpoint_id)
    REFERENCES webhook_endpoints(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id VARCHAR(191) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_events_event_id (event_id),
  KEY idx_events_type_created (event_type, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deliveries (
  event_pk BIGINT UNSIGNED NOT NULL,
  endpoint_id BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'succeeded', 'failed') NOT NULL DEFAULT 'pending',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_response_status SMALLINT UNSIGNED NULL,
  last_error VARCHAR(2048) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  completed_at TIMESTAMP(3) NULL,
  PRIMARY KEY (event_pk, endpoint_id),
  KEY idx_deliveries_endpoint_updated (endpoint_id, updated_at),
  CONSTRAINT fk_delivery_event FOREIGN KEY (event_pk)
    REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_endpoint FOREIGN KEY (endpoint_id)
    REFERENCES webhook_endpoints(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
