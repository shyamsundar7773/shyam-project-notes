import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const startsBackend = Boolean(process.env.PORT)
const backendUrl = new URL('../backend/dist/server.js', import.meta.url)

if (startsBackend && !existsSync(fileURLToPath(backendUrl))) {
  console.error('Backend build is missing. Run npm run build before starting the server.')
  process.exitCode = 1
} else if (startsBackend) {
  await import(backendUrl.href)
} else {
  await import('./start-expo.mjs')
}
