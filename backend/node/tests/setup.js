process.env.JWT_SECRET = 'test-only-secret-with-at-least-32-bytes'

// Full runs must not pass by silently skipping the database suites.
if (process.env.REQUIRE_TEST_DATABASE === '1' && !process.env.TEST_DATABASE_URL) {
  throw new Error('REQUIRE_TEST_DATABASE=1 needs TEST_DATABASE_URL (docker compose -f docker-compose.test.yml up -d --wait)')
}
