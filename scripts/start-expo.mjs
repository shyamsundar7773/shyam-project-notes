import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const expoCli = fileURLToPath(
  new URL('../node_modules/expo/bin/cli', import.meta.url),
)
const expo = spawn(
  process.execPath,
  [expoCli, 'start', ...process.argv.slice(2)],
  {
    env: { ...process.env, EXPO_NO_TYPESCRIPT_SETUP: '1' },
    stdio: 'inherit',
  },
)

expo.on('error', (error) => {
  console.error(`Could not start Expo: ${error.message}`)
  process.exitCode = 1
})

expo.on('exit', (code) => {
  process.exitCode = code ?? 1
})
