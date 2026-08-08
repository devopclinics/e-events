CREATE TABLE IF NOT EXISTS ticket_transfers (
  id VARCHAR(36) PRIMARY KEY, order_id VARCHAR(36) NOT NULL REFERENCES orders(id), event_id VARCHAR(36) NOT NULL,
  guest_id VARCHAR(36) NOT NULL, recipient_name VARCHAR(200) NOT NULL, recipient_email VARCHAR(255) NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE, status VARCHAR(30) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(), accepted_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_transfer_order ON ticket_transfers(order_id);
CREATE INDEX IF NOT EXISTS ix_transfer_event ON ticket_transfers(event_id);
CREATE INDEX IF NOT EXISTS ix_transfer_guest ON ticket_transfers(guest_id);
CREATE INDEX IF NOT EXISTS ix_transfer_status ON ticket_transfers(status);
