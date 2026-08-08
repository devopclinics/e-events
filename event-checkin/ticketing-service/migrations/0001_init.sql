CREATE TABLE IF NOT EXISTS event_configs (
  event_id varchar(36) PRIMARY KEY, org_id varchar(36) NOT NULL,
  enabled boolean NOT NULL DEFAULT false, currency varchar(3) NOT NULL DEFAULT 'USD',
  provider varchar(20) NOT NULL DEFAULT 'stripe', provider_account_id varchar(255),
  fee_bps integer NOT NULL DEFAULT 500, fees_paid_by varchar(20) NOT NULL DEFAULT 'buyer',
  created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_event_configs_org_id ON event_configs(org_id);
CREATE TABLE IF NOT EXISTS ticket_products (
  id varchar(36) PRIMARY KEY, event_id varchar(36) NOT NULL, access_ticket_type_id varchar(36),
  name varchar(120) NOT NULL, description text, price integer NOT NULL, currency varchar(3) NOT NULL,
  capacity integer NOT NULL, sold integer NOT NULL DEFAULT 0, min_per_order integer NOT NULL DEFAULT 1,
  max_per_order integer NOT NULL DEFAULT 10, sale_starts_at timestamp, sale_ends_at timestamp,
  active boolean NOT NULL DEFAULT true, sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ticket_products_event_id ON ticket_products(event_id);
CREATE TABLE IF NOT EXISTS promo_codes (
  id varchar(36) PRIMARY KEY, event_id varchar(36) NOT NULL, code varchar(40) NOT NULL,
  kind varchar(12) NOT NULL DEFAULT 'percent', amount integer NOT NULL, max_uses integer,
  uses integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_promo_event_code UNIQUE(event_id, code)
);
CREATE TABLE IF NOT EXISTS orders (
  id varchar(36) PRIMARY KEY, event_id varchar(36) NOT NULL, org_id varchar(36) NOT NULL,
  buyer_name varchar(200) NOT NULL, buyer_email varchar(255) NOT NULL, buyer_phone varchar(50),
  currency varchar(3) NOT NULL, subtotal integer NOT NULL, discount integer NOT NULL DEFAULT 0,
  platform_fee integer NOT NULL DEFAULT 0, total integer NOT NULL, status varchar(30) NOT NULL DEFAULT 'pending',
  provider varchar(20) NOT NULL, provider_reference varchar(255) UNIQUE, payment_reference varchar(255), checkout_url text,
  promo_code varchar(40), hold_expires_at timestamp NOT NULL, paid_at timestamp, fulfilled_at timestamp,
  fulfillment_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_orders_event_id ON orders(event_id);
CREATE INDEX IF NOT EXISTS ix_orders_org_id ON orders(org_id);
CREATE INDEX IF NOT EXISTS ix_orders_buyer_email ON orders(buyer_email);
CREATE INDEX IF NOT EXISTS ix_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS ix_orders_hold_expires_at ON orders(hold_expires_at);
CREATE TABLE IF NOT EXISTS order_items (
  id varchar(36) PRIMARY KEY, order_id varchar(36) NOT NULL REFERENCES orders(id),
  product_id varchar(36) NOT NULL REFERENCES ticket_products(id), product_name varchar(120) NOT NULL,
  unit_price integer NOT NULL, quantity integer NOT NULL, attendee_data jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_order_items_order_id ON order_items(order_id);
CREATE TABLE IF NOT EXISTS payment_events (
  id varchar(36) PRIMARY KEY, provider varchar(20) NOT NULL, provider_event_id varchar(255) NOT NULL,
  event_type varchar(100) NOT NULL, payload jsonb NOT NULL, processed boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(), CONSTRAINT uq_provider_event UNIQUE(provider, provider_event_id)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id varchar(36) PRIMARY KEY, order_id varchar(36) NOT NULL REFERENCES orders(id), kind varchar(30) NOT NULL,
  amount integer NOT NULL, currency varchar(3) NOT NULL, provider_reference varchar(255),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ledger_entries_order_id ON ledger_entries(order_id);
