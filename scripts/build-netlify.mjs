import { access, readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const publicEnvironmentAliases = [
  ['EXPO_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL'],
  ['EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY'],
  ['EXPO_PUBLIC_API_BASE_URL', 'VITE_BACKEND_URL'],
]

export function createNetlifyExpoEnvironment(environment) {
  const result = { ...environment }
  for (const [expoName, viteName] of publicEnvironmentAliases) {
    if (!result[expoName]?.trim()) {
      result[expoName] = result[viteName]?.trim() ?? ''
    }
  }

  const missing = publicEnvironmentAliases
    .map(([name]) => name)
    .filter((name) => !result[name]?.trim())
  if (missing.length > 0) {
    throw new Error(
      `Netlify Expo build requires public frontend configuration: ${missing.join(', ')}. Set these Expo variables or their Vite equivalents.`,
    )
  }

  return result
}

async function verifyExpoExport(outputDirectory) {
  for (const route of [
    'index.html',
    'sign-in.html',
    'home.html',
    'notes.html',
    'note.html',
  ]) {
    await access(new URL(`../${outputDirectory}/${route}`, import.meta.url))
  }
  const entries = await readdir(
    new URL(`../${outputDirectory}/_expo/static/js/web/`, import.meta.url),
  )
  if (!entries.some((entry) => entry.endsWith('.js'))) {
    throw new Error('Netlify output does not contain the Expo web application bundle.')
  }
}

async function build() {
  const fileEnvironment = loadEnv('production', process.cwd(), '')
  const environment = createNetlifyExpoEnvironment({
    ...fileEnvironment,
    ...process.env,
  })
  const expoCli = fileURLToPath(
    new URL('../node_modules/expo/bin/cli', import.meta.url),
  )
  const outputDirectory = 'expo-web-build'
  const processHandle = spawn(
    process.execPath,
    ['--', expoCli, 'export', '--platform', 'web', '--output-dir', outputDirectory],
    {
      env: { ...environment, EXPO_NO_TYPESCRIPT_SETUP: '1' },
      stdio: 'inherit',
    },
  )

  processHandle.on('error', (error) => {
    console.error(`Could not start the Expo Netlify export: ${error.message}`)
    process.exitCode = 1
  })
  processHandle.on('exit', async (code) => {
    if (code !== 0) {
      process.exitCode = code ?? 1
      return
    }
    try {
      await verifyExpoExport(outputDirectory)
      console.log('Verified Expo Router routes and web bundle for Netlify.')
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'Expo Netlify output verification failed.',
      )
      process.exitCode = 1
    }
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await build()
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Netlify Expo build configuration is invalid.',
    )
    process.exitCode = 1
  }
}
