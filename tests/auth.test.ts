import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  passwordRecoveryLinkError,
  passwordRecoveryRedirect,
  recoveryModeAfterAuthEvent,
  updatePasswordFromRecovery,
  validateEmailInput,
  validateNewPassword,
  validatePasswordInput,
} from '../src/lib/auth'
import { getAuthErrorMessage } from '../src/lib/phase1'

function mockAuthClient(fetcher: typeof fetch): SupabaseClient {
  return createClient('https://auth.example.test', 'test-publishable-key', {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: fetcher },
  })
}

function sessionResponse() {
  return Response.json({
    access_token: 'mock-access-token',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'mock-refresh-token',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'learner@example.test',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
      created_at: '2026-10-16T00:00:00.000Z',
    },
  })
}

test('validates login/recovery email and new-password form values', () => {
  assert.match(validateEmailInput(' ') ?? '', /email address/i)
  assert.match(validateEmailInput('not-an-email') ?? '', /valid email/i)
  assert.equal(validateEmailInput('  learner@example.test  '), null)
  assert.match(validatePasswordInput('') ?? '', /password/i)
  assert.match(validateNewPassword('short', 'short') ?? '', /8 characters/i)
  assert.match(validateNewPassword('long-enough', 'different') ?? '', /match/i)
  assert.equal(validateNewPassword('long-enough', 'long-enough'), null)
})

test('builds desktop and LAN password recovery redirects from the app origin', () => {
  assert.equal(
    passwordRecoveryRedirect('http://localhost:5173'),
    'http://localhost:5173/reset-password',
  )
  assert.equal(
    passwordRecoveryRedirect('http://192.168.1.20:5173'),
    'http://192.168.1.20:5173/reset-password',
  )
})

test('requires a Supabase recovery event with a session and keeps it through user updates', () => {
  assert.equal(
    recoveryModeAfterAuthEvent(false, 'PASSWORD_RECOVERY', true),
    true,
  )
  assert.equal(
    recoveryModeAfterAuthEvent(false, 'PASSWORD_RECOVERY', false),
    false,
  )
  assert.equal(recoveryModeAfterAuthEvent(false, 'SIGNED_IN', true), false)
  assert.equal(recoveryModeAfterAuthEvent(true, 'USER_UPDATED', true), true)
  assert.equal(recoveryModeAfterAuthEvent(true, 'SIGNED_OUT', false), false)
  assert.equal(
    recoveryModeAfterAuthEvent(false, 'SIGNED_IN', true),
    false,
  )
})

test('maps expired links without accepting arbitrary recovery URL parameters', () => {
  assert.match(
    passwordRecoveryLinkError('?error_code=otp_expired') ?? '',
    /expired or invalid/i,
  )
  assert.match(
    passwordRecoveryLinkError('', '#error=access_denied') ?? '',
    /expired or invalid/i,
  )
  assert.equal(passwordRecoveryLinkError('?unrelated=value'), null)
  assert.equal(
    passwordRecoveryLinkError('', '#type=recovery'),
    null,
  )
})

test('recovery errors never expose provider response details', () => {
  const sensitiveProviderError = {
    message: 'provider echoed a private credential',
    code: 'unexpected_provider_response',
  }
  const safeMessage = getAuthErrorMessage(sensitiveProviderError)
  assert.match(safeMessage, /could not be completed/i)
  assert.doesNotMatch(safeMessage, /private credential/i)
})

test('Supabase password sign-in sends supplied email/password and accepts a mocked session', async () => {
  let requestedUrl = ''
  let requestedBody: Record<string, unknown> = {}
  const client = mockAuthClient(async (input, init) => {
    requestedUrl = String(input)
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return sessionResponse()
  })

  const { data, error } = await client.auth.signInWithPassword({
    email: 'learner@example.test',
    password: 'user-entered-test-password',
  })
  assert.equal(error, null)
  assert.ok(data.session)
  assert.match(requestedUrl, /\/auth\/v1\/token\?grant_type=password$/)
  assert.deepEqual(requestedBody, {
    email: 'learner@example.test',
    password: 'user-entered-test-password',
    gotrue_meta_security: {},
  })
  await client.auth.signOut()
})

test('Supabase password sign-in maps a mocked invalid-credentials response', async () => {
  const client = mockAuthClient(async () =>
    Response.json(
      {
        code: 'invalid_credentials',
        message: 'Invalid login credentials',
      },
      { status: 400 },
    ),
  )
  const { error } = await client.auth.signInWithPassword({
    email: 'learner@example.test',
    password: 'incorrect-test-password',
  })
  assert.equal(error?.message, 'Invalid login credentials')
  assert.match(
    getAuthErrorMessage(error),
    /forgot password/i,
  )
})

test('Supabase session can be restored from storage and cleared on sign-out', async () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
  const client = createClient(
    'https://auth.example.test',
    'test-publishable-key',
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        storage,
      },
      global: { fetch: async () => sessionResponse() },
    },
  )
  const signedIn = await client.auth.signInWithPassword({
    email: 'learner@example.test',
    password: 'user-entered-test-password',
  })
  assert.ok(signedIn.data.session)

  const restoredClient = createClient(
    'https://auth.example.test',
    'test-publishable-key',
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        storage,
      },
      global: { fetch: async () => sessionResponse() },
    },
  )
  const restored = await restoredClient.auth.getSession()
  assert.ok(restored.data.session)
  assert.equal(restored.data.session.user.email, 'learner@example.test')

  const signedOut = await restoredClient.auth.signOut({ scope: 'local' })
  assert.equal(signedOut.error, null)
  const afterSignOut = await restoredClient.auth.getSession()
  assert.equal(afterSignOut.data.session, null)
})

test('Supabase recovery email and password update use the installed Auth SDK methods', async () => {
  const requests: Array<{
    url: string
    method: string
    body: Record<string, unknown>
    authorization: string | null
  }> = []
  const client = mockAuthClient(async (input, init) => {
    const url = new URL(String(input))
    const body = init?.body
      ? (JSON.parse(String(init.body)) as Record<string, unknown>)
      : {}
    requests.push({
      url: `${url.pathname}${url.search}`,
      method: init?.method ?? 'GET',
      body,
      authorization: new Headers(init?.headers).get('authorization'),
    })
    if (url.pathname.endsWith('/recover')) return Response.json({})
    if (url.pathname.endsWith('/token')) return sessionResponse()
    if (url.pathname.endsWith('/user')) {
      return Response.json({
        id: '00000000-0000-0000-0000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'learner@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
        identities: [],
        created_at: '2026-10-16T00:00:00.000Z',
      })
    }
    return Response.json({ message: 'unexpected request' }, { status: 404 })
  })

  const redirectTo = passwordRecoveryRedirect('http://192.168.1.20:5173')
  const resetResult = await client.auth.resetPasswordForEmail(
    'learner@example.test',
    { redirectTo },
  )
  assert.equal(resetResult.error, null)
  assert.match(requests[0].url, /\/auth\/v1\/recover\?/)
  assert.equal(new URLSearchParams(requests[0].url.split('?')[1]).get('redirect_to'), redirectTo)
  assert.deepEqual(requests[0].body, {
    email: 'learner@example.test',
    code_challenge: null,
    code_challenge_method: null,
    gotrue_meta_security: {},
  })

  assert.match(
    (await updatePasswordFromRecovery(
      client,
      false,
      'new-mock-password',
      'new-mock-password',
    )) ?? '',
    /valid password recovery session/i,
  )
  assert.equal(requests.some((request) => request.url.startsWith('/auth/v1/user')), false)
  assert.match(
    (await updatePasswordFromRecovery(client, true, 'short', 'short')) ?? '',
    /8 characters/i,
  )
  assert.equal(requests.some((request) => request.url.startsWith('/auth/v1/user')), false)

  const { error: loginError } = await client.auth.signInWithPassword({
    email: 'learner@example.test',
    password: 'mock-password',
  })
  assert.equal(loginError, null)
  assert.equal(
    await updatePasswordFromRecovery(
      client,
      true,
      'new-mock-password',
      'new-mock-password',
    ),
    null,
  )
  const updateRequest = requests.find((request) =>
    request.url.startsWith('/auth/v1/user'),
  )
  assert.ok(updateRequest)
  assert.equal(updateRequest.method, 'PUT')
  assert.equal(updateRequest.body.password, 'new-mock-password')
  assert.equal(updateRequest.authorization, 'Bearer mock-access-token')
  await client.auth.signOut()
})

test('password recovery update errors hide sensitive provider details', async () => {
  const client = mockAuthClient(async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/token')) return sessionResponse()
    if (url.pathname.endsWith('/user')) {
      return Response.json(
        {
          message: 'provider echoed a private credential',
          code: 'unexpected_provider_response',
        },
        { status: 400 },
      )
    }
    return Response.json({}, { status: 200 })
  })
  const { error: loginError } = await client.auth.signInWithPassword({
    email: 'learner@example.test',
    password: 'mock-password',
  })
  assert.equal(loginError, null)

  const message = await updatePasswordFromRecovery(
    client,
    true,
    'new-mock-password',
    'new-mock-password',
  )
  assert.match(message ?? '', /could not be completed/i)
  assert.doesNotMatch(message ?? '', /private credential/i)
  await client.auth.signOut()
})
