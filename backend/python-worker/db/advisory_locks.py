"""PostgreSQL advisory lock keys shared with the Node API (src/db/advisory-locks.js)."""

# Catalog sync and gift persistence: deposits, imports and custody snapshots.
GIFT_PERSISTENCE_LOCK = 847522020
# Held for the worker's lifetime: only one process may open the Telegram session.
TELEGRAM_SESSION_LOCK = 847522023
