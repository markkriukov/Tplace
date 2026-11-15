import { schemas, id } from './schemas.js'

// Built only from route definitions and the input schemas the router validates against,
// so it cannot drift from the code. Response bodies are intentionally not described.
export function buildOpenApi(routes) {
  const paths = {}
  for (const route of routes) {
    const parameters = []
    if (route.path.includes('{id}')) parameters.push({ name: 'id', in: 'path', required: true, schema: id })
    for (const [name, schema] of Object.entries(schemas[route.query]?.properties ?? {})) {
      parameters.push({ name, in: 'query', required: false, schema, style: 'form', explode: true })
    }
    paths[route.path] ??= {}
    paths[route.path][route.method.toLowerCase()] = {
      operationId: `${route.handler.name}_${route.path.replace(/[^a-zA-Z0-9]/g, '_')}`,
      security: ['required', 'admin'].includes(route.auth) ? [{ bearerAuth: [] }] : route.auth === 'optional' ? [{}, { bearerAuth: [] }] : [],
      parameters,
      ...(route.body ? { requestBody: { required: route.body !== 'empty', content: { 'application/json': { schema: schemas[route.body] } } } } : {}),
      responses: { default: { description: 'JSON response; errors are { ok: false, error, code, request_id }' } },
    }
  }
  return {
    openapi: '3.1.0', info: { title: 'TPlace API', version: '1.0.0' }, paths,
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  }
}
