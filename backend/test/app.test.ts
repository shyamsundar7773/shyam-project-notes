import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, type ApiProviders } from '../src/app.js'
import {
  parseMarkdownConversion,
  parseSqlEvaluation,
  validateAiText,
} from '../src/ai-notes.js'
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
let sqlEvaluationCalls = 0
let markdownConversionCalls = 0
let convertImplementation: ApiProviders['convertNotes'] = async () =>
  convertedNotes
let verifyImplementation: ApiProviders['verifyAccessToken'] = async () => true
let sqlEvaluationImplementation: NonNullable<
  ApiProviders['evaluateSql']
> = async () => ({
  output: 'Illustrative rows only.',
  evaluation: 'Review the join condition.',
})
let markdownConversionImplementation: NonNullable<
  ApiProviders['convertMarkdown']
> = async () => '# Converted Markdown'

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
    evaluateSql: (sql, context) => {
      sqlEvaluationCalls += 1
      return sqlEvaluationImplementation(sql, context)
    },
    convertMarkdown: (markdown) => {
      markdownConversionCalls += 1
      return markdownConversionImplementation(markdown)
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

test('CORS accepts an explicit comma-separated origin allowlist only', async () => {
  const lanConfig = parseConfig({
    ...config,
    FRONTEND_ORIGIN:
      'http://localhost:5173, http://192.168.1.20:5173, https://unrelated.example',
  })
  assert.deepEqual(lanConfig.frontendOrigins, [
    'https://shyam-project-notes.netlify.app',
    'http://localhost:5173',
    'http://192.168.1.20:5173',
    'https://unrelated.example',
  ])
  const lanServer = createServer(
    createApp(lanConfig, {
      verifyAccessToken: async () => true,
      convertNotes: async () => convertedNotes,
    }),
  )
  await new Promise<void>((resolve) =>
    lanServer.listen(0, '127.0.0.1', resolve),
  )
  const address = lanServer.address() as AddressInfo
  try {
    const allowed = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { origin: 'http://192.168.1.20:5173' },
    })
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'http://192.168.1.20:5173',
    )
    const rejected = await fetch(`http://127.0.0.1:${address.port}/health`, {
      headers: { origin: 'http://192.168.1.21:5173' },
    })
    assert.equal(rejected.headers.get('access-control-allow-origin'), null)
  } finally {
    await new Promise<void>((resolve, reject) =>
      lanServer.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('production AI CORS preflight and authenticated SQL and Markdown requests work', async () => {
  const origin = 'https://shyam-project-notes.netlify.app'
  assert.ok(config.frontendOrigins.includes(origin))
  const testServer = createServer(
    createApp(config, {
      verifyAccessToken: async (token) => token === 'verified-test-token',
      convertNotes: async () => convertedNotes,
      evaluateSql: async () => ({
        output: 'Illustrative rows only.',
        evaluation: 'Review the join condition.',
      }),
      convertMarkdown: async () => '# Converted Markdown',
    }),
  )
  await new Promise<void>((resolve) =>
    testServer.listen(0, '127.0.0.1', resolve),
  )
  const address = testServer.address() as AddressInfo
  const testBaseUrl = `http://127.0.0.1:${address.port}`

  try {
    for (const path of [
      '/api/notes/evaluate-sql',
      '/api/notes/convert-markdown',
    ]) {
      const preflight = await fetch(`${testBaseUrl}${path}`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,content-type',
        },
      })
      assert.equal(preflight.status, 204)
      assert.equal(preflight.headers.get('access-control-allow-origin'), origin)
      assert.match(
        preflight.headers.get('access-control-allow-headers') ?? '',
        /authorization/i,
      )
      assert.match(
        preflight.headers.get('access-control-allow-headers') ?? '',
        /content-type/i,
      )
    }

    const sqlResponse = await fetch(`${testBaseUrl}/api/notes/evaluate-sql`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer verified-test-token',
        'content-type': 'application/json',
        origin,
      },
      body: JSON.stringify({ sql: 'SELECT * FROM example_table;' }),
    })
    assert.equal(sqlResponse.status, 200)
    assert.equal(sqlResponse.headers.get('access-control-allow-origin'), origin)
    assert.deepEqual(await sqlResponse.json(), {
      output: 'Illustrative rows only.',
      evaluation: 'Review the join condition.',
    })

    const markdownResponse = await fetch(
      `${testBaseUrl}/api/notes/convert-markdown`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer verified-test-token',
          'content-type': 'application/json',
          origin,
        },
        body: JSON.stringify({ markdown: '# Raw source' }),
      },
    )
    assert.equal(markdownResponse.status, 200)
    assert.equal(
      markdownResponse.headers.get('access-control-allow-origin'),
      origin,
    )
    assert.deepEqual(await markdownResponse.json(), {
      convertedMarkdown: '# Converted Markdown',
    })
  } finally {
    await new Promise<void>((resolve, reject) =>
      testServer.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

test('validates and evaluates SQL only after token verification', async () => {
  assert.equal(validateAiText({ sql: 'SELECT 1' }, 'sql'), 'SELECT 1')
  assert.equal(validateAiText({ sql: ' ' }, 'sql'), null)
  assert.equal(validateAiText({ sql: 12 }, 'sql'), null)

  const missing = await fetch(`${baseUrl}/api/notes/evaluate-sql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(missing.status, 400)

  verifyImplementation = async () => false
  const rejected = await fetch(`${baseUrl}/api/notes/evaluate-sql`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer invalid-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sql: 'SELECT 1' }),
  })
  assert.equal(rejected.status, 401)
  const before = sqlEvaluationCalls
  assert.equal(sqlEvaluationCalls, before)

  verifyImplementation = async () => true
  const response = await fetch(`${baseUrl}/api/notes/evaluate-sql`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sql: 'SELECT * FROM example_table;' }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    output: 'Illustrative rows only.',
    evaluation: 'Review the join condition.',
  })
  assert.equal(sqlEvaluationCalls, before + 1)
})

test('rejects malformed practice SQL and requires authentication for practice questions', async () => {
  verifyImplementation = async () => true
  const malformed = await fetch(`${baseUrl}/api/notes/run-sql`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer verified-test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ sql: 'SELECT FROM employees' }),
  })
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error.code, 'SQL_EXECUTION_FAILED')

  verifyImplementation = async () => false
  const unauthenticated = await fetch(
    `${baseUrl}/api/notes/practice-question`,
  )
  assert.equal(unauthenticated.status, 401)
  verifyImplementation = async () => true
})

test('keeps Gemini evaluation separate and returns safe errors on evaluation failure', async () => {
  let submittedSql = ''
  let submittedContext: { question: string; result: string } | undefined
  sqlEvaluationImplementation = async (sql, context) => {
    submittedSql = sql
    submittedContext = context
    throw new Error('private Gemini failure detail')
  }
  const response = await fetch(`${baseUrl}/api/notes/evaluate-sql`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer verified-test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sql: 'SELECT name FROM employees',
      question: 'List employee names.',
      executionResult: '{"rows":[{"name":"Asha"}]}',
    }),
  })
  const body = await response.text()
  assert.equal(response.status, 502)
  assert.equal(body.includes('private Gemini failure detail'), false)
  assert.equal(submittedSql, 'SELECT name FROM employees')
  assert.deepEqual(submittedContext, {
    question: 'List employee names.',
    result: '{"rows":[{"name":"Asha"}]}',
  })
  sqlEvaluationImplementation = async () => ({
    output: 'Illustrative rows only.',
    evaluation: 'Review the join condition.',
  })
})

test('serves practice questions and runs sandbox SQL only for verified users', async () => {
  const headers = {
    authorization: 'Bearer verified-test-token',
    'content-type': 'application/json',
  }
  const question = await fetch(`${baseUrl}/api/notes/practice-question`, {
    headers,
  })
  assert.equal(question.status, 200)
  const questionBody = (await question.json()) as { prompt: string; schema: string[] }
  assert.match(questionBody.prompt, /employees/i)
  assert.ok(questionBody.schema.some((table) => table.startsWith('employees(')))

  const execution = await fetch(`${baseUrl}/api/notes/run-sql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sql: 'SELECT name FROM employees ORDER BY id LIMIT 2',
    }),
  })
  assert.equal(execution.status, 200)
  assert.deepEqual(await execution.json(), {
    columns: ['name'],
    rows: [{ name: 'Asha' }, { name: 'Ben' }],
    rowLimit: 200,
    truncated: false,
  })

  verifyImplementation = async () => false
  const rejected = await fetch(`${baseUrl}/api/notes/run-sql`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sql: 'SELECT name FROM employees' }),
  })
  assert.equal(rejected.status, 401)
  verifyImplementation = async () => true
})

test('converts Markdown with safe errors and preserves source-side failure details', async () => {
  assert.equal(
    validateAiText({ markdown: '# Notes' }, 'markdown'),
    '# Notes',
  )
  assert.equal(validateAiText({ markdown: '' }, 'markdown'), null)
  assert.equal(parseMarkdownConversion('# Converted'), '# Converted')
  assert.throws(() => parseMarkdownConversion('  '))

  const response = await fetch(`${baseUrl}/api/notes/convert-markdown`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ markdown: '# Raw source' }),
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    convertedMarkdown: '# Converted Markdown',
  })

  markdownConversionImplementation = async () => {
    throw new Error('sensitive provider details')
  }
  const failed = await fetch(`${baseUrl}/api/notes/convert-markdown`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer valid-test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ markdown: '<script>raw stays user-side</script>' }),
  })
  const body = await failed.text()
  assert.equal(failed.status, 502)
  assert.equal(body.includes('sensitive provider details'), false)
  assert.equal(markdownConversionCalls, 2)
  markdownConversionImplementation = async () => '# Converted Markdown'
})

test('parses structured SQL evaluation without claiming execution', () => {
  assert.deepEqual(
    parseSqlEvaluation(
      JSON.stringify({
        output: 'Illustrative output only.',
        evaluation: 'Check table names before execution.',
      }),
    ),
    {
      output: 'Illustrative output only.',
      evaluation: 'Check table names before execution.',
    },
  )
  assert.throws(() =>
    parseSqlEvaluation(JSON.stringify({ output: '', evaluation: 'Review' })),
  )
})
