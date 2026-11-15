import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { sequelize, withoutTimeouts } from './sequelize.js'
import { ADVISORY_LOCKS } from './advisory-locks.js'

const defaultDirectory = fileURLToPath(new URL('../../../db/migrations/', import.meta.url))

export async function readMigrations(directory = process.env.MIGRATIONS_PATH || defaultDirectory) {
  const names = (await fs.readdir(directory))
    .filter((name) => /^\d+_[\w-]+\.sql$/.test(name))
    .sort()
  if (!names.length) throw new Error(`No migrations found in ${directory}`)
  return Promise.all(
    names.map(async (name) => {
      const sql = (await fs.readFile(path.join(directory, name), 'utf8')).replaceAll('\r\n', '\n')
      return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') }
    })
  )
}

export async function migrateDatabase({ database = sequelize, directory } = {}) {
  const migrations = await readMigrations(directory)
  return database.transaction(async (transaction) => {
    await withoutTimeouts(transaction, database)
    // Serialize concurrent deploys on the same database.
    await database.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: ADVISORY_LOCKS.migrations }, transaction })
    await database.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
      { transaction }
    )
    const [rows] = await database.query('SELECT name, checksum FROM schema_migrations', {
      transaction,
    })
    const applied = new Map(rows.map((row) => [row.name, row.checksum]))
    const executed = []
    for (const migration of migrations) {
      if (applied.has(migration.name)) {
        if (applied.get(migration.name) !== migration.checksum) {
          throw new Error(`Applied migration was modified: ${migration.name}`)
        }
        continue
      }
      await database.query(migration.sql, { transaction })
      await database.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES (:name, :checksum)',
        {
          replacements: migration,
          transaction,
        }
      )
      executed.push(migration.name)
    }
    return executed
  })
}

export async function assertMigrationsCurrent() {
  const migrations = await readMigrations()
  let rows
  try {
    ;[rows] = await sequelize.query('SELECT name, checksum FROM schema_migrations')
  } catch (error) {
    throw new Error('Database migrations are required: run npm run db:migrate', { cause: error })
  }
  const applied = new Map(rows.map((row) => [row.name, row.checksum]))
  for (const migration of migrations) {
    if (applied.get(migration.name) !== migration.checksum) {
      throw new Error(
        `Database migration missing or changed: ${migration.name}. Run npm run db:migrate`
      )
    }
  }
}
