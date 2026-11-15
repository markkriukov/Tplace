import test from 'node:test'
import assert from 'node:assert/strict'
import { recordRequest, httpMetrics } from '../src/http/metrics.js'

test('route metrics report size, errors and bounded duration buckets', () => {
  recordRequest(200, 5, 'GET /search', 100)
  recordRequest(500, 200, 'GET /search', 60)
  recordRequest(429, 6000, 'GET /search', 40)
  const metrics = httpMetrics()
  const route = metrics.routes['GET /search']
  assert.equal(route.requests, 3)
  assert.equal(route.server_errors, 1)
  assert.equal(route.rate_limited, 1)
  assert.equal(route.response_bytes, 200)
  assert.equal(route.max_duration_ms, 6000)
  assert.equal(route.average_duration_ms, 6205 / 3)
  assert.equal(route.duration_buckets['10'], 1)
  assert.equal(route.duration_buckets['250'], 1)
  assert.equal(route.duration_buckets['+Inf'], 1)
  route.duration_buckets['10'] = 99
  assert.equal(httpMetrics().routes['GET /search'].duration_buckets['10'], 1)
  recordRequest(404, 1, '/missing?token=private')
  assert.equal(JSON.stringify(httpMetrics()).includes('private'), false)
})
