import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

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
