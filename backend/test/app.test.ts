import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, type ApiProviders } from '../src/app.js'
import { parseConfig } from '../src/config.js'
import type { ConvertedNotes } from '../src/notes.js'

const convertedNotes: ConvertedNotes = {
  title: 'Study notes',
  summary: 'A concise summary.',
  sections: [{ heading: 'Main idea', content: 'Key details.' }],
  keyTakeaways: ['Review the main idea.'],
}

const config = parseConfig({
  GEMINI_API_KEY: 'test-gemini-key',
  GEMINI_PRIMARY_MODEL: 'test-model',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key',
  FRONTEND_ORIGIN: 'http://localhost:5173',
})

let server: Server
let baseUrl: string
let verifyCalls = 0
let conversionCalls = 0
let convertImplementation: ApiProviders['convertNotes'] = async () =>
  convertedNotes
let verifyImplementation: ApiProviders['verifyAccessToken'] = async () => true

before(async () => {
  const app = createApp(config, {
    verifyAccessToken: (token) => {
      verifyCalls += 1
      return verifyImplementation(token)
    },
    convertNotes: (text) => {
      conversionCalls += 1
      return convertImplementation(text)
    },
  })

  server = createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

test('health endpoint responds without exposing configuration', async () => {
  const response = await fetch(`${baseUrl}/health`)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
})

test('rejects missing and malformed request data', async () => {
  const missing = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  assert.equal(missing.status, 400)

  const malformed = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"text":',
  })
  assert.equal(malformed.status, 400)

  const blank = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '  ' }),
  })
  assert.equal(blank.status, 400)

  const oversized = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(600_000) }),
  })
  assert.equal(oversized.status, 413)
})

test('rejects missing, malformed, and invalid bearer tokens', async () => {
  verifyImplementation = async () => false
  const missingToken = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Notes' }),
  })
  assert.equal(missingToken.status, 401)

  const malformedToken = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: {
      authorization: 'Basic token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text: 'Notes' }),
  })
  assert.equal(malformedToken.status, 401)

  const rejectedToken = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer invalid-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text: 'Notes' }),
  })
  assert.equal(rejectedToken.status, 401)
  assert.equal(conversionCalls, 0)
  verifyImplementation = async () => true
})

test('requires the primary Gemini model and API key, not fallback models', async () => {
  const missingGeminiConfig = parseConfig({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-key',
    FRONTEND_ORIGIN: 'http://localhost:5173',
  })
  const missingApp = createApp(missingGeminiConfig, {
    verifyAccessToken: async () => true,
    convertNotes: async () => convertedNotes,
  })
  const missingServer = createServer(missingApp)
  await new Promise<void>((resolve) =>
    missingServer.listen(0, '127.0.0.1', resolve),
  )
  const address = missingServer.address() as AddressInfo

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/notes/convert`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: 'Notes' }),
      },
    )
    assert.equal(response.status, 503)
    assert.equal('geminiFallbackModels' in missingGeminiConfig, false)
  } finally {
    await new Promise<void>((resolve, reject) =>
      missingServer.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('returns structured conversion output using mocked providers only', async () => {
  let tokenSeen = ''
  let textSeen = ''
  verifyImplementation = async (token) => {
    tokenSeen = token
    return true
  }
  convertImplementation = async (text) => {
    textSeen = text
    return convertedNotes
  }

  const response = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer verified-test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text: 'Raw notes to convert' }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { conversion: convertedNotes })
  assert.equal(tokenSeen, 'verified-test-token')
  assert.equal(textSeen, 'Raw notes to convert')
})

test('returns generic upstream errors without provider details', async () => {
  convertImplementation = async () => {
    throw new Error('sensitive provider response and test secret')
  }

  const response = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text: 'Raw notes' }),
  })
  const body = await response.text()
  assert.equal(response.status, 502)
  assert.equal(body.includes('sensitive provider response'), false)
  assert.equal(body.includes('test secret'), false)

  convertImplementation = async () => {
    throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
  }
  const timedOut = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text: 'Raw notes' }),
  })
  assert.equal(timedOut.status, 504)
  convertImplementation = async () => convertedNotes
})

test('conversion flow only verifies auth and converts; it has no database-write path', async () => {
  const beforeVerifyCalls = verifyCalls
  const beforeConversionCalls = conversionCalls
  const response = await fetch(`${baseUrl}/api/notes/convert`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ text: 'Do not save this note' }),
  })

  assert.equal(response.status, 200)
  assert.equal(verifyCalls, beforeVerifyCalls + 1)
  assert.equal(conversionCalls, beforeConversionCalls + 1)
})

test('CORS allows the configured local frontend origin only', async () => {
  const allowed = await fetch(`${baseUrl}/health`, {
    headers: { origin: 'http://localhost:5173' },
  })
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'http://localhost:5173',
  )

  const blocked = await fetch(`${baseUrl}/health`, {
    headers: { origin: 'http://localhost:4173' },
  })
  assert.equal(blocked.headers.get('access-control-allow-origin'), null)
})
