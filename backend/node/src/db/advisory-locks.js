// PostgreSQL advisory lock keys shared by every process on the database. The
// Python worker uses the same numbers in db/advisory_locks.py; keep them apart.
export const ADVISORY_LOCKS = Object.freeze({
  migrations: 847522019,
  // Catalog sync and the worker's gift persistence (deposits, imports, custody).
  giftPersistence: 847522020,
  tonPayments: 847522021,
  offerExpiry: 847522022,
})
