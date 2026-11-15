import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { tonConnectManifestPlugin } from './scripts/tonconnect-manifest.mjs'
import { devModuleCachePlugin } from './scripts/dev-module-cache.mjs'

// https://vite.dev/config/
export function createViteConfig({ mode }, envDir = fileURLToPath(new URL('../', import.meta.url))) {
  const env = loadEnv(mode, envDir, 'VITE_')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:4000'

  return {
    envDir,
    envPrefix: 'VITE_',
    plugins: [devModuleCachePlugin(), react(), tonConnectManifestPlugin(env.VITE_TONCONNECT_APP_URL)],
    resolve: { dedupe: ['react', 'react-dom'] },
    server: {
      // Source modules must stay fresh when the dev server is behind the tunnel.
      headers: { 'Cache-Control': 'no-store' },
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
}

export default defineConfig(createViteConfig)
