-- PostgreSQL 18 schema for an empty database.
-- Internal keys are integers: a primary key is pk_<entity>_id, a foreign key
-- fk_<entity>_id. Public entities also have public_id, the UUIDv7 the API uses.
-- Telegram identifiers say so (telegram_id), flags start with is_, moments are
-- timestamptz named *_at. Indexes are idx_<table>_<purpose>; named constraints
-- fk_ / chk_ / uniq_ <entity>_<purpose>; others keep PostgreSQL's default
-- names; triggers are <table>_<purpose>.

-- Users -----------------------------------------------------------------------

CREATE TABLE users (
    pk_user_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),
    telegram_id BIGINT NOT NULL UNIQUE,
    username TEXT,
    first_name TEXT,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    -- Incrementing token_version revokes every token issued to the user.
    token_version INTEGER NOT NULL DEFAULT 0 CHECK (token_version >= 0)
);

-- Gift catalog (filled by the Changes API sync) --------------------------------

CREATE TABLE collections (
    pk_collection_id SERIAL PRIMARY KEY,
    short_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    collection_regular_id BIGINT,
    photo_url TEXT
);

CREATE INDEX idx_collections_regular_id ON collections (collection_regular_id);

CREATE TABLE models (
    pk_model_id SERIAL PRIMARY KEY,
    fk_collection_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    rarity TEXT,
    rarity_numeric NUMERIC GENERATED ALWAYS AS (CASE WHEN coalesce(rarity, '') ~ '^[0-9]+([,.][0-9]+)?%?$' THEN replace(replace(rarity, '%', ''), ',', '.')::numeric ELSE NULL END) STORED,
    url TEXT,

    CONSTRAINT fk_model_collection
        FOREIGN KEY (fk_collection_id)
        REFERENCES collections (pk_collection_id)
        ON DELETE CASCADE,

    CONSTRAINT uniq_model_collection_name
        UNIQUE (fk_collection_id, name),

    -- Target of the gift's (model, collection) key.
    CONSTRAINT uniq_model_id_collection
        UNIQUE (pk_model_id, fk_collection_id)
);

CREATE TABLE backgrounds (
    pk_background_id SERIAL PRIMARY KEY,
    background_id BIGINT UNIQUE,
    name TEXT NOT NULL UNIQUE,
    center_color BIGINT,
    edge_color BIGINT,
    pattern_color BIGINT,
    text_color BIGINT
);

CREATE TABLE symbols (
    pk_symbol_id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    url TEXT
);

CREATE TABLE collection_backgrounds (
    pk_collection_background_id SERIAL PRIMARY KEY,
    fk_collection_id INTEGER NOT NULL,
    fk_background_id INTEGER NOT NULL,
    rarity TEXT,
    rarity_numeric NUMERIC GENERATED ALWAYS AS (CASE WHEN coalesce(rarity, '') ~ '^[0-9]+([,.][0-9]+)?%?$' THEN replace(replace(rarity, '%', ''), ',', '.')::numeric ELSE NULL END) STORED,

    CONSTRAINT fk_collection_background_collection
        FOREIGN KEY (fk_collection_id)
        REFERENCES collections (pk_collection_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_collection_background_background
        FOREIGN KEY (fk_background_id)
        REFERENCES backgrounds (pk_background_id)
        ON DELETE CASCADE,

    CONSTRAINT uniq_collection_background
        UNIQUE (fk_collection_id, fk_background_id)
);

CREATE TABLE collection_symbols (
    pk_collection_symbol_id SERIAL PRIMARY KEY,
    fk_collection_id INTEGER NOT NULL,
    fk_symbol_id INTEGER NOT NULL,
    rarity TEXT,
    rarity_numeric NUMERIC GENERATED ALWAYS AS (CASE WHEN coalesce(rarity, '') ~ '^[0-9]+([,.][0-9]+)?%?$' THEN replace(replace(rarity, '%', ''), ',', '.')::numeric ELSE NULL END) STORED,

    CONSTRAINT fk_collection_symbol_collection
        FOREIGN KEY (fk_collection_id)
        REFERENCES collections (pk_collection_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_collection_symbol_symbol
        FOREIGN KEY (fk_symbol_id)
        REFERENCES symbols (pk_symbol_id)
        ON DELETE CASCADE,

    CONSTRAINT uniq_collection_symbol
        UNIQUE (fk_collection_id, fk_symbol_id)
);

-- Gifts and ownership ---------------------------------------------------------

CREATE TABLE gift_texts (
    pk_text_id SERIAL PRIMARY KEY,
    from_name TEXT NOT NULL,
    to_name TEXT NOT NULL,
    text TEXT
);

CREATE INDEX idx_gift_texts_names ON gift_texts (from_name, to_name);

CREATE TABLE gifts (
    pk_gift_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),
    telegram_gift_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    is_test_import BOOLEAN NOT NULL DEFAULT FALSE,
    gift_number NUMERIC GENERATED ALWAYS AS (CASE WHEN name ~ '-[0-9]+$' THEN substring(name from '-([0-9]+)$')::numeric ELSE telegram_gift_id::numeric END) STORED,
    -- Text search compares names without case and punctuation. Storing that
    -- form avoids a regular expression per scanned row.
    search_name TEXT GENERATED ALWAYS AS (regexp_replace(lower(name), '[^a-z0-9]+', '', 'g')) STORED,

    fk_collection_id INTEGER NOT NULL,
    fk_model_id INTEGER NOT NULL,
    fk_background_id INTEGER NOT NULL,
    fk_symbol_id INTEGER NOT NULL,
    fk_text_id INTEGER,

    -- The model, background and symbol belong to the gift's collection:
    -- fk_collection_id is the shared part of three composite keys.
    CONSTRAINT fk_gift_model_in_collection
        FOREIGN KEY (fk_model_id, fk_collection_id)
        REFERENCES models (pk_model_id, fk_collection_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_gift_background_in_collection
        FOREIGN KEY (fk_collection_id, fk_background_id)
        REFERENCES collection_backgrounds (fk_collection_id, fk_background_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_gift_symbol_in_collection
        FOREIGN KEY (fk_collection_id, fk_symbol_id)
        REFERENCES collection_symbols (fk_collection_id, fk_symbol_id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_gift_text
        FOREIGN KEY (fk_text_id)
        REFERENCES gift_texts (pk_text_id)
        ON DELETE SET NULL
);

CREATE UNIQUE INDEX idx_gifts_telegram_gift_id_unique ON gifts (telegram_gift_id);

-- Catalog pages sorted by gift number walk this index in either direction and
-- stop after one page instead of sorting every gift.
CREATE INDEX idx_gifts_number ON gifts (gift_number, pk_gift_id);

CREATE TABLE ownerships (
    pk_ownership_id SERIAL PRIMARY KEY,

    fk_user_id INTEGER NOT NULL,
    fk_gift_id INTEGER NOT NULL,

    acquired_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_ownership_user
        FOREIGN KEY (fk_user_id)
        REFERENCES users (pk_user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_ownership_gift
        FOREIGN KEY (fk_gift_id)
        REFERENCES gifts (pk_gift_id)
        ON DELETE CASCADE,

    CONSTRAINT uniq_ownership_user_gift
        UNIQUE (fk_user_id, fk_gift_id)
);

CREATE UNIQUE INDEX idx_ownerships_one_owner_per_gift ON ownerships (fk_gift_id);

CREATE TABLE gift_custody_observations (
    fk_gift_id INTEGER PRIMARY KEY REFERENCES gifts (pk_gift_id),
    fk_custodian_user_id INTEGER NOT NULL REFERENCES users (pk_user_id),
    is_present BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_at TIMESTAMPTZ,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE gift_custody_snapshots (
    fk_user_id INTEGER PRIMARY KEY REFERENCES users (pk_user_id),
    completed_run BIGINT NOT NULL,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE gift_custody_sync_run_seq;

CREATE TABLE gift_action_blocks (
    fk_gift_id INTEGER PRIMARY KEY REFERENCES gifts (pk_gift_id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (reason = 'DUPLICATE_REAL_DEPOSIT'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Listings and offers ---------------------------------------------------------

CREATE TABLE gift_listings (
    pk_gift_listing_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),

    fk_gift_id INTEGER,
    fk_seller_user_id INTEGER NOT NULL,
    fk_buyer_user_id INTEGER,

    currency_code TEXT NOT NULL DEFAULT 'GRAM',
    price_nano BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',

    listed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TIMESTAMPTZ,
    closed_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_gift_listing_gift
        FOREIGN KEY (fk_gift_id)
        REFERENCES gifts (pk_gift_id)
        ON DELETE SET NULL,

    CONSTRAINT fk_gift_listing_seller_user
        FOREIGN KEY (fk_seller_user_id)
        REFERENCES users (pk_user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_gift_listing_buyer_user
        FOREIGN KEY (fk_buyer_user_id)
        REFERENCES users (pk_user_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_gift_listing_price_positive
        CHECK (price_nano > 0),

    -- A sale is always 'sold'; closed_reason tells a direct sale from an offer.
    CONSTRAINT chk_gift_listing_status
        CHECK (status IN ('active', 'sold', 'canceled')),

    -- The reason determines the status, which stays for the partial indexes on
    -- active and sold listings (IS NOT NULL: a CHECK passes on NULL).
    CONSTRAINT chk_gift_listing_close_reason CHECK (CASE status
        WHEN 'active' THEN closed_reason IS NULL
        WHEN 'sold' THEN closed_reason IS NOT NULL AND closed_reason IN ('sold_direct', 'sold_offer', 'legacy')
        ELSE closed_reason IS NOT NULL AND closed_reason IN ('canceled_by_seller', 'withdrawal_requested', 'test_withdrawal', 'test_gift_replaced', 'legacy')
    END)
);

CREATE UNIQUE INDEX idx_gift_listings_one_active_per_gift
    ON gift_listings (fk_gift_id)
    WHERE status = 'active';

CREATE INDEX idx_gift_listings_gift_status
    ON gift_listings (fk_gift_id, status);

CREATE INDEX idx_gift_listings_active_price
    ON gift_listings (price_nano, fk_gift_id)
    WHERE status = 'active';

CREATE INDEX idx_gift_listings_active_date
    ON gift_listings (listed_at DESC, fk_gift_id DESC)
    WHERE status = 'active';

CREATE INDEX idx_gift_listings_sold_closed_at
    ON gift_listings (closed_at DESC, pk_gift_listing_id DESC)
    WHERE status = 'sold';

-- Sales history sorted by price pages through this instead of sorting every sale.
CREATE INDEX idx_gift_listings_sold_price
    ON gift_listings (price_nano, pk_gift_listing_id)
    WHERE status = 'sold';

CREATE TABLE offers (
    pk_offer_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),

    fk_gift_id INTEGER,
    fk_buyer_user_id INTEGER NOT NULL,
    fk_seller_user_id INTEGER NOT NULL,

    currency_code TEXT NOT NULL DEFAULT 'GRAM',
    amount_nano BIGINT NOT NULL,
    escrow_locked_nano BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',

    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,

    CONSTRAINT fk_offer_gift
        FOREIGN KEY (fk_gift_id)
        REFERENCES gifts (pk_gift_id)
        ON DELETE SET NULL,

    CONSTRAINT fk_offer_buyer_user
        FOREIGN KEY (fk_buyer_user_id)
        REFERENCES users (pk_user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_offer_seller_user
        FOREIGN KEY (fk_seller_user_id)
        REFERENCES users (pk_user_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_offer_amount_positive
        CHECK (amount_nano > 0),

    CONSTRAINT chk_offer_escrow_locked
        CHECK (escrow_locked_nano >= 0 AND escrow_locked_nano <= amount_nano),

    CONSTRAINT chk_offer_status
        CHECK (status IN ('pending', 'accepted', 'rejected', 'canceled', 'expired'))
);

CREATE INDEX idx_offers_seller_status_created
    ON offers (fk_seller_user_id, status, created_at DESC);

CREATE INDEX idx_offers_buyer_status_created
    ON offers (fk_buyer_user_id, status, created_at DESC);

CREATE INDEX idx_offers_gift_status_created
    ON offers (fk_gift_id, status, created_at DESC);

CREATE UNIQUE INDEX idx_offers_one_pending_per_buyer_gift
    ON offers (fk_gift_id, fk_buyer_user_id)
    WHERE status = 'pending';

CREATE INDEX idx_offers_seller_id ON offers (fk_seller_user_id, pk_offer_id DESC);

CREATE INDEX idx_offers_buyer_id ON offers (fk_buyer_user_id, pk_offer_id DESC);

CREATE INDEX idx_offers_expiry_pending ON offers (expires_at, pk_offer_id) WHERE status = 'pending';

-- Wallets and ledger ----------------------------------------------------------

-- A wallet's total is available + locked; it is computed where it is read.
CREATE TABLE wallet_balances (
    pk_wallet_balance_id SERIAL PRIMARY KEY,
    fk_user_id INTEGER NOT NULL UNIQUE,

    currency_code TEXT NOT NULL DEFAULT 'GRAM',
    available_nano BIGINT NOT NULL DEFAULT 0,
    locked_nano BIGINT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_wallet_balance_user
        FOREIGN KEY (fk_user_id)
        REFERENCES users (pk_user_id)
        ON DELETE CASCADE,

    CONSTRAINT chk_wallet_supported_balance
        CHECK (available_nano + locked_nano <= 9007199254740991),

    CONSTRAINT chk_wallet_non_negative
        CHECK (available_nano >= 0 AND locked_nano >= 0)
);

CREATE TABLE wallet_transactions (
    pk_wallet_tx_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),
    fk_user_id INTEGER NOT NULL,

    tx_kind TEXT NOT NULL,
    direction TEXT NOT NULL,
    status TEXT NOT NULL,

    amount_nano BIGINT NOT NULL,
    fee_nano BIGINT NOT NULL DEFAULT 0,

    balance_before_nano BIGINT,
    balance_after_nano BIGINT,

    fk_gift_id INTEGER,
    -- Offers and users are never deleted, so these keys need no index on this
    -- write-heavy table. An offer entry's other side is the offer's buyer or
    -- seller, so only entries without an offer (direct trades) store one.
    fk_offer_id INTEGER REFERENCES offers (pk_offer_id),
    fk_counterparty_user_id INTEGER REFERENCES users (pk_user_id),

    idempotency_key TEXT,
    external_ref TEXT,
    note TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finalized_at TIMESTAMPTZ,

    CONSTRAINT fk_wallet_tx_user
        FOREIGN KEY (fk_user_id)
        REFERENCES users (pk_user_id)
        ON DELETE CASCADE,

    CONSTRAINT fk_wallet_tx_gift
        FOREIGN KEY (fk_gift_id)
        REFERENCES gifts (pk_gift_id)
        ON DELETE SET NULL,

    CONSTRAINT chk_wallet_tx_amount_positive
        CHECK (amount_nano > 0),

    CONSTRAINT chk_wallet_tx_fee_non_negative
        CHECK (fee_nano >= 0),

    CONSTRAINT chk_wallet_tx_direction
        CHECK (direction IN ('credit', 'debit')),

    CONSTRAINT chk_wallet_tx_status
        CHECK (status IN ('pending', 'completed', 'failed', 'canceled')),

    CONSTRAINT chk_wallet_tx_counterparty_source
        CHECK (fk_offer_id IS NULL OR fk_counterparty_user_id IS NULL)
);

CREATE UNIQUE INDEX idx_wallet_tx_idempotency_unique
    ON wallet_transactions (idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Wallet history pages by key. Being unique, the index is also the target of
-- the TON payment's (ledger entry, user) key.
CREATE UNIQUE INDEX idx_wallet_tx_user_id ON wallet_transactions (fk_user_id, pk_wallet_tx_id DESC);

-- Deleting a gift (test imports) nulls its ledger references; without this
-- index the foreign key action scans the whole ledger inside the trade's locks.
CREATE INDEX idx_wallet_tx_gift ON wallet_transactions (fk_gift_id) WHERE fk_gift_id IS NOT NULL;

-- Every user has a wallet from the moment the user row exists, whichever
-- service created it (API sign-in or the worker's gift deposits). Trades then
-- lock all participating wallets with one query instead of creating them lazily.
-- An upsert that updates an existing user fires no INSERT row trigger.
CREATE FUNCTION create_user_wallet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO wallet_balances (fk_user_id) VALUES (NEW.pk_user_id)
  ON CONFLICT (fk_user_id) DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE TRIGGER users_create_wallet AFTER INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION create_user_wallet();

-- TON payments ----------------------------------------------------------------

CREATE TABLE ton_payments (
    pk_payment_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),
    fk_user_id INTEGER NOT NULL,
    fk_wallet_tx_id INTEGER NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('deposit', 'withdraw')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'broadcast', 'completed', 'review', 'expired')),
    network TEXT NOT NULL CHECK (network IN ('-239', '-3')),
    treasury_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    amount_nano BIGINT NOT NULL CHECK (amount_nano > 0),
    fee_nano BIGINT NOT NULL DEFAULT 0 CHECK (fee_nano >= 0),
    memo TEXT NOT NULL UNIQUE,
    valid_until BIGINT NOT NULL,
    signed_boc TEXT,
    tx_hash TEXT,
    -- A payout batch is one signed treasury transfer. Its seqno proves, after
    -- the transfer expires, whether the wallet could still have executed it.
    seqno BIGINT CHECK (seqno >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (network, tx_hash),

    -- A payment's user is its ledger entry's user. The column stays for the
    -- per-user payment list.
    CONSTRAINT fk_ton_payment_wallet_tx_user
        FOREIGN KEY (fk_wallet_tx_id, fk_user_id)
        REFERENCES wallet_transactions (pk_wallet_tx_id, fk_user_id)
        ON DELETE RESTRICT
);

CREATE INDEX idx_ton_payments_user ON ton_payments (fk_user_id, pk_payment_id DESC);

CREATE INDEX idx_ton_payments_pending ON ton_payments (updated_at) WHERE status <> 'completed';

CREATE INDEX idx_ton_payments_payout_queue ON ton_payments (pk_payment_id) WHERE kind = 'withdraw' AND status = 'queued';

CREATE TABLE payment_review_audit (
    pk_payment_review_id SERIAL PRIMARY KEY,
    fk_payment_id INTEGER NOT NULL REFERENCES ton_payments (pk_payment_id),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Treasury history is scanned once per worker pass from a durable cursor.
-- Every inbound transfer either settles a pending deposit or is recorded for review.
CREATE TABLE ton_scan_cursors (
    network TEXT NOT NULL CHECK (network IN ('-239', '-3')),
    address TEXT NOT NULL,
    last_lt NUMERIC(20, 0) NOT NULL CHECK (last_lt >= 0),
    last_hash TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (network, address)
);

-- A paid deposit that would exceed the supported balance is recorded here
-- (balance_limit) instead of failing the scan, whose cursor could never pass it.
CREATE TABLE ton_unmatched_deposits (
    pk_unmatched_deposit_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),
    network TEXT NOT NULL CHECK (network IN ('-239', '-3')),
    treasury_address TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    tx_lt NUMERIC(20, 0) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL,
    sender_address TEXT NOT NULL,
    amount_nano NUMERIC(20, 0) NOT NULL CHECK (amount_nano > 0),
    memo TEXT,
    fk_payment_id INTEGER REFERENCES ton_payments (pk_payment_id) ON DELETE RESTRICT,
    reason TEXT NOT NULL CHECK (reason IN ('unknown_memo', 'payment_mismatch', 'payment_expired', 'payment_settled_elsewhere', 'balance_limit')),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    resolution_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    UNIQUE (network, tx_hash)
);

CREATE INDEX idx_ton_unmatched_deposits_open ON ton_unmatched_deposits (pk_unmatched_deposit_id) WHERE status = 'open';

-- Telegram gift deposits, imports and withdrawals -----------------------------

CREATE TABLE telegram_gift_deposits (
    pk_deposit_id SERIAL PRIMARY KEY,
    custodian_telegram_id BIGINT NOT NULL CHECK (custodian_telegram_id > 0),
    message_id BIGINT NOT NULL CHECK (message_id > 0),
    chat_id BIGINT NOT NULL,
    sender_telegram_id BIGINT NOT NULL CHECK (sender_telegram_id > 0),
    fk_gift_id INTEGER NOT NULL REFERENCES gifts (pk_gift_id),
    -- transfer_gift(owned_gift_id=..., new_owner_chat_id=...) accepts this user message ID.
    owned_gift_id TEXT NOT NULL,
    received_gift_id TEXT NOT NULL,
    transfer_star_count BIGINT CHECK (transfer_star_count >= 0),
    next_transfer_at TIMESTAMPTZ,
    next_resale_at TIMESTAMPTZ,
    export_at TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('credited', 'ownership_conflict')),
    received_at TIMESTAMPTZ NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (custodian_telegram_id, message_id)
);

-- Serves lookups by gift and is the target of the withdrawal's (deposit, gift) key.
CREATE UNIQUE INDEX idx_telegram_gift_deposits_gift ON telegram_gift_deposits (fk_gift_id, pk_deposit_id);

CREATE TABLE admin_gift_imports (
    pk_gift_import_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),
    fk_admin_user_id INTEGER NOT NULL REFERENCES users (pk_user_id),
    request_key VARCHAR(128) NOT NULL,
    username VARCHAR(32) NOT NULL,
    max_count INTEGER NOT NULL CHECK (max_count BETWEEN 1 AND 1000),
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    result JSONB,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE (fk_admin_user_id, request_key)
);

CREATE UNIQUE INDEX idx_admin_gift_imports_one_active ON admin_gift_imports (fk_admin_user_id)
    WHERE status IN ('queued', 'running');

CREATE INDEX idx_admin_gift_imports_queue ON admin_gift_imports (pk_gift_import_id) WHERE status = 'queued';

-- The recipient is the owner's Telegram account (users.telegram_id).
CREATE TABLE gift_withdrawals (
    pk_gift_withdrawal_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),
    fk_gift_id INTEGER NOT NULL,
    fk_deposit_id INTEGER NOT NULL,
    fk_user_id INTEGER NOT NULL REFERENCES users (pk_user_id),
    request_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'completed', 'failed', 'review')),
    error_code TEXT,
    fee_nano BIGINT NOT NULL DEFAULT 0 CHECK (fee_nano >= 0),
    fk_fee_wallet_tx_id INTEGER UNIQUE REFERENCES wallet_transactions (pk_wallet_tx_id) ON DELETE RESTRICT,
    transfer_star_count BIGINT CHECK (transfer_star_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_check_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (fk_user_id, request_key),

    -- A withdrawal's gift is its deposit's gift. The column stays for the
    -- "one active withdrawal per gift" index.
    CONSTRAINT fk_gift_withdrawal_deposit_gift
        FOREIGN KEY (fk_deposit_id, fk_gift_id)
        REFERENCES telegram_gift_deposits (pk_deposit_id, fk_gift_id),

    CONSTRAINT chk_gift_withdrawal_fee_reference
        CHECK ((fee_nano = 0 AND fk_fee_wallet_tx_id IS NULL) OR (fee_nano > 0 AND fk_fee_wallet_tx_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_gift_withdrawals_one_active ON gift_withdrawals (fk_gift_id)
    WHERE status IN ('queued', 'sending', 'review');

-- The worker polls only unfinished withdrawals.
CREATE INDEX idx_gift_withdrawals_poll ON gift_withdrawals (next_check_at, pk_gift_withdrawal_id)
    WHERE status IN ('queued', 'sending', 'review');

-- Marketplace fees and news ---------------------------------------------------

-- Fee income, kept apart from any wallet. Each entry has exactly one source.
CREATE TABLE marketplace_fee_entries (
    pk_marketplace_fee_id SERIAL PRIMARY KEY,
    fk_gift_listing_id INTEGER UNIQUE REFERENCES gift_listings (pk_gift_listing_id) ON DELETE RESTRICT,
    fk_offer_id INTEGER UNIQUE REFERENCES offers (pk_offer_id) ON DELETE RESTRICT,
    fk_legacy_wallet_tx_id INTEGER UNIQUE REFERENCES wallet_transactions (pk_wallet_tx_id) ON DELETE RESTRICT,
    fk_gift_withdrawal_id INTEGER UNIQUE REFERENCES gift_withdrawals (pk_gift_withdrawal_id) ON DELETE RESTRICT,
    currency_code TEXT NOT NULL DEFAULT 'GRAM',
    amount_nano BIGINT NOT NULL CHECK (amount_nano >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_marketplace_fee_one_source CHECK (
        num_nonnulls(fk_gift_listing_id, fk_offer_id, fk_legacy_wallet_tx_id, fk_gift_withdrawal_id) = 1
    )
);

CREATE FUNCTION reject_marketplace_fee_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Marketplace fee entries are append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER marketplace_fee_entries_immutable
    BEFORE UPDATE OR DELETE ON marketplace_fee_entries
    FOR EACH ROW EXECUTE FUNCTION reject_marketplace_fee_mutation();

CREATE TRIGGER marketplace_fee_entries_no_truncate
    BEFORE TRUNCATE ON marketplace_fee_entries
    FOR EACH STATEMENT EXECUTE FUNCTION reject_marketplace_fee_mutation();

-- Completing or failing a withdrawal settles its reserved fee: completion
-- charges it and records the income, failure releases it to the balance.
CREATE FUNCTION settle_gift_withdrawal_fee() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  wallet wallet_balances%ROWTYPE;
  ledger wallet_transactions%ROWTYPE;
  total bigint;
BEGIN
  IF NEW.fee_nano IS DISTINCT FROM OLD.fee_nano
    OR NEW.fk_fee_wallet_tx_id IS DISTINCT FROM OLD.fk_fee_wallet_tx_id
    OR NEW.fk_user_id IS DISTINCT FROM OLD.fk_user_id THEN
    RAISE EXCEPTION 'Withdrawal fee terms are immutable';
  END IF;
  IF NEW.status=OLD.status THEN RETURN NEW; END IF;
  IF OLD.status IN ('completed','failed') THEN
    RAISE EXCEPTION 'Terminal withdrawals cannot be reopened';
  END IF;
  IF NEW.fee_nano=0 OR NEW.status NOT IN ('completed','failed') THEN RETURN NEW; END IF;

  SELECT * INTO STRICT wallet FROM wallet_balances WHERE fk_user_id=NEW.fk_user_id FOR UPDATE;
  SELECT * INTO STRICT ledger FROM wallet_transactions WHERE pk_wallet_tx_id=NEW.fk_fee_wallet_tx_id FOR UPDATE;
  IF wallet.currency_code<>'GRAM' OR wallet.locked_nano<NEW.fee_nano
    OR ledger.fk_user_id<>NEW.fk_user_id OR ledger.status<>'pending'
    OR ledger.tx_kind<>'gift_withdrawal_fee' OR ledger.direction<>'debit'
    OR ledger.amount_nano<>NEW.fee_nano OR ledger.fk_gift_id IS DISTINCT FROM NEW.fk_gift_id THEN
    RAISE EXCEPTION 'Withdrawal fee reservation is invalid';
  END IF;
  total := wallet.available_nano + wallet.locked_nano;

  IF NEW.status='completed' THEN
    UPDATE wallet_balances SET locked_nano=locked_nano-NEW.fee_nano,updated_at=now()
      WHERE pk_wallet_balance_id=wallet.pk_wallet_balance_id;
    UPDATE wallet_transactions SET status='completed',balance_before_nano=total,
      balance_after_nano=total-NEW.fee_nano,finalized_at=now()
      WHERE pk_wallet_tx_id=ledger.pk_wallet_tx_id;
    INSERT INTO marketplace_fee_entries(fk_gift_withdrawal_id,currency_code,amount_nano)
      VALUES (NEW.pk_gift_withdrawal_id,'GRAM',NEW.fee_nano);
  ELSE
    UPDATE wallet_balances SET locked_nano=locked_nano-NEW.fee_nano,
      available_nano=available_nano+NEW.fee_nano,updated_at=now() WHERE pk_wallet_balance_id=wallet.pk_wallet_balance_id;
    UPDATE wallet_transactions SET status='canceled',balance_before_nano=total,
      balance_after_nano=total,finalized_at=now(),
      meta=meta || jsonb_build_object('release_reason',NEW.error_code)
      WHERE pk_wallet_tx_id=ledger.pk_wallet_tx_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER gift_withdrawals_fee_settlement BEFORE UPDATE ON gift_withdrawals
    FOR EACH ROW EXECUTE FUNCTION settle_gift_withdrawal_fee();

-- News is published exactly when it has a publication date.
CREATE TABLE news (
    pk_news_id SERIAL PRIMARY KEY,
    public_id UUID NOT NULL UNIQUE DEFAULT uuidv7(),

    title TEXT NOT NULL,
    lead TEXT,
    content TEXT NOT NULL,
    image_url TEXT,

    published_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The published list sorts by publication date with missing dates last.
CREATE INDEX idx_news_published
    ON news (published_at DESC NULLS LAST, created_at DESC)
    WHERE published_at IS NOT NULL;

-- Service state ---------------------------------------------------------------

CREATE TABLE worker_status (
    name TEXT PRIMARY KEY,
    last_success_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ
);

-- One row per catalog source holding its last successful sync, not an import log.
CREATE TABLE catalog_sync_state (
    source TEXT PRIMARY KEY,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    counts JSONB NOT NULL
);
