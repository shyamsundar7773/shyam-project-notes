import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { createNetlifyExpoEnvironment } from '../scripts/build-netlify.mjs'

test('local browser development and Netlify use the Expo Router frontend', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { scripts: Record<string, string> }
  const netlifyConfig = await readFile(
    new URL('../netlify.toml', import.meta.url),
    'utf8',
  )

  assert.match(packageJson.scripts.dev, /start-expo\.mjs --web --port 5173/)
  assert.equal(packageJson.scripts['dev:vite'], 'vite')
  assert.equal(
    packageJson.scripts['build:netlify'],
    'npm run typecheck:expo && node scripts/build-netlify.mjs',
  )
  assert.match(netlifyConfig, /command = "npm run build:netlify"/)
  assert.match(netlifyConfig, /publish = "expo-web-build"/)
  assert.match(netlifyConfig, /to = "\/:route\.html"/)
})

test('Netlify Expo builds reuse explicit Expo config or existing Vite public values', () => {
  const environment = createNetlifyExpoEnvironment({
    VITE_SUPABASE_URL: 'https://project.example',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public-key',
    VITE_BACKEND_URL: 'https://shyam-project-notes.onrender.com',
  })

  assert.equal(environment.EXPO_PUBLIC_SUPABASE_URL, 'https://project.example')
  assert.equal(
    environment.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'sb_publishable_public-key',
  )
  assert.equal(
    environment.EXPO_PUBLIC_API_BASE_URL,
    'https://shyam-project-notes.onrender.com',
  )

  assert.throws(
    () =>
      createNetlifyExpoEnvironment({
        VITE_SUPABASE_URL: 'https://project.example',
      }),
    /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, EXPO_PUBLIC_API_BASE_URL/,
  )
})

test('explicit Expo config takes precedence over Vite aliases for Netlify', () => {
  const environment = createNetlifyExpoEnvironment({
    EXPO_PUBLIC_SUPABASE_URL: 'https://expo-project.example',
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'expo-publishable-key',
    EXPO_PUBLIC_API_BASE_URL: 'https://api.example',
    VITE_SUPABASE_URL: 'https://vite-project.example',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'vite-publishable-key',
    VITE_BACKEND_URL: 'https://vite-api.example',
  })

  assert.equal(
    environment.EXPO_PUBLIC_SUPABASE_URL,
    'https://expo-project.example',
  )
  assert.equal(
    environment.EXPO_PUBLIC_API_BASE_URL,
    'https://api.example',
  )
})
