import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { parseConfig } from './config.js'
import { createProviders } from './providers.js'

const rootEnvironmentFile = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.env.local',
)

if (existsSync(rootEnvironmentFile)) {
  process.loadEnvFile(rootEnvironmentFile)
}

const config = parseConfig(process.env)
const app = createApp(config, createProviders(config))
const port = Number(process.env.PORT ?? '3001')

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be a valid TCP port.')
}

createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`Backend listening on port ${port}`)
})
