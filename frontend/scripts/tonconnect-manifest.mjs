import { readFileSync } from 'node:fs'

export function createManifest(origin) {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.username || url.password ||
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) {
    throw new Error('TON Connect requires a public HTTPS app URL')
  }
  return { url: url.origin, name: 'TPlace', iconUrl: `${url.origin}/tonconnect-icon.png` }
}

export function tonConnectManifestPlugin(appUrl = '') {
  // A wallet downloads this file independently of the dApp. The canonical
  // origin must never come from localhost or a reverse proxy's internal Host.
  const fallback = JSON.parse(readFileSync(new URL('../public/tonconnect-manifest.json', import.meta.url), 'utf8'))
  const manifest = createManifest(appUrl.trim() || fallback.url)
  const middleware = (server) => {
    server.middlewares.use((req, res, next) => {
      const path = req.url?.split('?')[0]
      if (!['/tonconnect-manifest.json', '/tonconnect-icon.png'].includes(path)) return next()
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return }
      if (path === '/tonconnect-icon.png') return next()
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(manifest))
    })
  }
  return {
    name: 'tonconnect-manifest',
    configureServer: middleware,
    configurePreviewServer: middleware,
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'tonconnect-manifest.json', source: JSON.stringify(manifest, null, 2) })
    },
  }
}
