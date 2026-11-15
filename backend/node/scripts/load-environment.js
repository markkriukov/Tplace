import { loadEnvFile } from 'node:process'

// Local commands read the shared root .env; containers receive settings from Compose.
// Not using --env-file-if-exists: on Node 24, --watch with a missing /.env still aborts the process on shutdown in containers.

try {
  loadEnvFile(new URL('../../../.env', import.meta.url))
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
