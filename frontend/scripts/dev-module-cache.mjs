import { fileURLToPath } from 'node:url'

export function devModuleCachePlugin() {
  const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url)).replaceAll('\\', '/')
  const version = Date.now().toString(36)

  return {
    name: 'tplace-dev-module-cache',
    apply: 'serve',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      // Cloudflare can cache .js while passing .jsx through to Vite. Version local
      // source imports together so a restart cannot mix old and new React URLs.
      if (!source.startsWith('.') || !source.endsWith('.js') ||
          !importer?.replaceAll('\\', '/').startsWith(sourceRoot)) return null

      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!resolved || resolved.external || !resolved.id.replaceAll('\\', '/').startsWith(sourceRoot)) return null
      return { ...resolved, id: `${resolved.id}?dev=${version}` }
    },
  }
}
