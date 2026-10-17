import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { resolveFrontendEnvironment } from '../vite.config'

async function templateVariableNames(path: string): Promise<string[]> {
  const content = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  return content
    .split(/\r?\n/)
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((name): name is string => Boolean(name))
}

test('frontend template contains only used public Vite and Expo variable names', async () => {
  const variables = await templateVariableNames('.env.example')
  assert.deepEqual(variables, [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'VITE_BACKEND_URL',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'EXPO_PUBLIC_API_BASE_URL',
  ])
  assert.equal(
    variables.some((name) =>
      /GEMINI|SERVICE_ROLE|SUPABASE_SECRET|GOOGLE_API_KEY/i.test(name),
    ),
    false,
  )
})

test('backend template declares only backend runtime variable names', async () => {
  assert.deepEqual(await templateVariableNames('backend/.env.example'), [
    'PORT',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'GEMINI_API_KEY',
    'GEMINI_PRIMARY_MODEL',
    'FRONTEND_ORIGIN',
  ])
})

test('Vite reuses Expo public Supabase settings when Vite settings are absent', () => {
  assert.deepEqual(
    resolveFrontendEnvironment({
      EXPO_PUBLIC_SUPABASE_URL: 'https://project.example',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public-key',
      EXPO_PUBLIC_API_BASE_URL: 'https://api.example',
    }),
    {
      supabaseUrl: 'https://project.example',
      supabasePublishableKey: 'sb_publishable_public-key',
      backendUrl: '',
    },
  )
})

test('Vite-specific Supabase values take precedence over Expo values', () => {
  assert.deepEqual(
    resolveFrontendEnvironment({
      VITE_SUPABASE_URL: 'https://vite-project.example',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'vite-public-key',
      EXPO_PUBLIC_SUPABASE_URL: 'https://expo-project.example',
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'expo-public-key',
      VITE_BACKEND_URL: 'https://backend.example',
    }),
    {
      supabaseUrl: 'https://vite-project.example',
      supabasePublishableKey: 'vite-public-key',
      backendUrl: 'https://backend.example',
    },
  )
})
