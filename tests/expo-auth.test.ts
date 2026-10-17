import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import {
  routeForAuthState,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  validateSignUpInput,
} from '../src/lib/expo-auth'
import { canInitializeExpoSupabase } from '../src/lib/expo-runtime'
import {
  establishExpoRecoverySession,
  expoRecoveryRedirectUrl,
  hasPasswordRecoveryCallback,
  requestExpoPasswordRecovery,
  updatePasswordFromRecovery,
} from '../src/lib/expo-password-recovery'
import { describeSupabaseConfiguration } from '../src/lib/supabase-config'

function authTestClient(fetcher: typeof fetch) {
  return createClient('https://auth.example.test', 'test-publishable-key', {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: fetcher },
  })
}

test('validates Expo sign-up and chooses a route only after restoration', () => {
  assert.match(validateSignUpInput('bad-email', 'long-enough') ?? '', /valid email/i)
  assert.match(
    validateSignUpInput('learner@example.test', 'short') ?? '',
    /at least 6 characters/i,
  )
  assert.equal(validateSignUpInput('learner@example.test', 'long-enough'), null)

  assert.equal(routeForAuthState(true, false), null)
  assert.equal(routeForAuthState(false, false), '/sign-in')
  assert.equal(routeForAuthState(false, true), '/home')
})

test('reports missing and unsafe Expo public Supabase configuration', () => {
  const missing = describeSupabaseConfiguration(
    '',
    '',
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  )
  assert.equal(missing.state, 'missing')
  assert.match(missing.message, /EXPO_PUBLIC_SUPABASE_URL/)

  const unsafeKey = describeSupabaseConfiguration(
    'https://project.example.test',
    'sb_secret_do-not-use',
    'Expo public environment',
  )
  assert.equal(unsafeKey.state, 'invalid')
  assert.doesNotMatch(unsafeKey.message, /sb_secret_do-not-use/)
})

test('defers Expo Supabase initialization during web server rendering only', () => {
  assert.equal(canInitializeExpoSupabase('web', false), false)
  assert.equal(canInitializeExpoSupabase('web', true), true)
  assert.equal(canInitializeExpoSupabase('android', false), true)
})

test('keeps email-confirmation sign-up messaging and provider errors safe', async () => {
  let signupPath = ''
  let signupRedirect: string | null = null
  let signupBody: Record<string, unknown> = {}
  const client = authTestClient(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/signup')) {
      signupPath = url.pathname
      signupRedirect = url.searchParams.get('redirect_to')
      signupBody = JSON.parse(String(init?.body)) as Record<string, unknown>
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
    return Response.json(
      {
        code: 'unexpected_provider_response',
        message: 'private provider diagnostic',
      },
      { status: 400 },
    )
  })

  const signUp = await signUpWithPassword(
    client,
    ' learner@example.test ',
    'mock-password',
  )
  assert.equal(signUp.error, null)
  assert.equal(signUp.session, null)
  assert.match(signUp.message ?? '', /confirm your address/i)
  assert.ok(signupPath.endsWith('/signup'))
  assert.equal(signupRedirect, null)
  assert.deepEqual(signupBody, {
    email: 'learner@example.test',
    password: 'mock-password',
    data: {},
    gotrue_meta_security: {},
    code_challenge: null,
    code_challenge_method: null,
  })

  const signIn = await signInWithPassword(
    client,
    'learner@example.test',
    'mock-password',
  )
  assert.match(signIn.error ?? '', /could not be completed/i)
  assert.doesNotMatch(signIn.error ?? '', /private provider diagnostic/)
})

test('rejects invalid sign-in locally without making an auth request', async () => {
  let called = false
  const client = authTestClient(async () => {
    called = true
    return Response.json({})
  })

  const result = await signInWithPassword(client, 'bad', '')
  assert.match(result.error ?? '', /valid email/i)
  assert.equal(called, false)
})

test('builds recovery redirects for web and the active Expo Go runtime', () => {
  assert.equal(
    expoRecoveryRedirectUrl(false, '', (path) => `https://notes.example.test${path}`),
    'https://notes.example.test/reset-password',
  )
  assert.equal(
    expoRecoveryRedirectUrl(
      true,
      'exp://192.168.1.20:8081/--/',
      () => 'unexpected',
    ),
    'exp://192.168.1.20:8081/--/reset-password',
  )
  assert.equal(
    hasPasswordRecoveryCallback(
      'https://notes.example.test/reset-password#type=recovery&access_token=hidden&refresh_token=hidden',
    ),
    true,
  )
  assert.equal(
    hasPasswordRecoveryCallback('https://notes.example.test/reset-password'),
    false,
  )
})

test('submits a validated recovery email using the explicit runtime redirect', async () => {
  let called = false
  let body: Record<string, unknown> = {}
  let requestedRedirect = ''
  const client = authTestClient(async (input, init) => {
    const url = new URL(String(input))
    called = true
    requestedRedirect = url.searchParams.get('redirect_to') ?? ''
    body = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json({})
  })
  const invalid = await requestExpoPasswordRecovery(
    client,
    'bad-email',
    'exp://192.168.1.20:8081/--/reset-password',
  )
  assert.match(invalid.error ?? '', /valid email/i)
  assert.equal(called, false)

  const result = await requestExpoPasswordRecovery(
    client,
    ' learner@example.test ',
    'exp://192.168.1.20:8081/--/reset-password',
  )
  assert.equal(result.error, null)
  assert.match(result.message ?? '', /instructions will be sent/i)
  assert.equal(
    requestedRedirect,
    'exp://192.168.1.20:8081/--/reset-password',
  )
  assert.equal(body.email, 'learner@example.test')
})

test('accepts only recovery callbacks and reports missing or expired sessions safely', async () => {
  const client = authTestClient(async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/token')) {
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
    return Response.json({ message: 'unexpected request' }, { status: 400 })
  })
  const accepted = await establishExpoRecoverySession(
    client,
    'shyam-project-notes://reset-password#type=recovery&access_token=eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJleHAiOjF9.&refresh_token=mock-refresh-token',
  )
  assert.ok(accepted.session)
  assert.equal(accepted.error, null)
  await client.auth.signOut()

  assert.equal(
    (
      await establishExpoRecoverySession(
        authTestClient(async () =>
          Response.json({ message: 'unexpected request' }, { status: 400 }),
        ),
        'https://notes.example.test/reset-password',
      )
    ).session,
    null,
  )
  assert.match(
    (
      await establishExpoRecoverySession(
        authTestClient(async () =>
          Response.json({ message: 'unexpected request' }, { status: 400 }),
        ),
        'https://notes.example.test/reset-password#error_code=otp_expired',
      )
    ).error ?? '',
    /expired or invalid/i,
  )
})

test('updates the password only with a recovery session and preserves normal sign-in', async () => {
  let updatedPassword = ''
  const client = authTestClient(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/token')) {
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
    if (url.pathname.endsWith('/user')) {
      updatedPassword = (
        JSON.parse(String(init?.body)) as { password: string }
      ).password
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
    return Response.json({})
  })

  const normalSignIn = await signInWithPassword(
    client,
    'learner@example.test',
    'mock-password',
  )
  assert.ok(normalSignIn.session)
  assert.match(
    (await updatePasswordFromRecovery(
      client,
      false,
      'new-mock-password',
      'new-mock-password',
    )) ?? '',
    /valid password recovery session/i,
  )
  assert.match(
    (await updatePasswordFromRecovery(
      client,
      true,
      'short',
      'short',
    )) ?? '',
    /8 characters/i,
  )
  assert.match(
    (await updatePasswordFromRecovery(
      client,
      true,
      'new-mock-password',
      'different-password',
    )) ?? '',
    /do not match/i,
  )
  assert.equal(
    await updatePasswordFromRecovery(
      client,
      true,
      'new-mock-password',
      'new-mock-password',
    ),
    null,
  )
  assert.equal(updatedPassword, 'new-mock-password')
  await client.auth.signOut()
})

test('Expo sign-out clears the SDK-persisted session', async () => {
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
      global: {
        fetch: async (input) => {
          if (new URL(String(input)).pathname.endsWith('/token')) {
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
          return Response.json({})
        },
      },
    },
  )

  const signedIn = await client.auth.signInWithPassword({
    email: 'learner@example.test',
    password: 'mock-password',
  })
  assert.ok(signedIn.data.session)
  assert.equal(await signOut(client), null)
  assert.equal((await client.auth.getSession()).data.session, null)
})
