import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { validateEmailInput, validatePasswordInput } from './auth'
import { getAuthErrorMessage } from './phase1'

export type AuthActionResult = {
  session: Session | null
  error: string | null
  message: string | null
}

export function routeForAuthState(
  loading: boolean,
  hasSession: boolean,
): '/home' | '/sign-in' | null {
  if (loading) return null
  return hasSession ? '/home' : '/sign-in'
}

export function validateSignUpInput(
  email: string,
  password: string,
): string | null {
  return (
    validateEmailInput(email) ??
    (password.length < 6
      ? 'Use a password with at least 6 characters.'
      : null)
  )
}

export async function signInWithPassword(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<AuthActionResult> {
  const validationError =
    validateEmailInput(email) ?? validatePasswordInput(password)
  if (validationError) {
    return { session: null, error: validationError, message: null }
  }

  try {
    const { data, error } = await client.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    if (error) {
      return { session: null, error: getAuthErrorMessage(error), message: null }
    }
    if (!data.session) {
      return {
        session: null,
        error: 'Sign-in did not return a session. Try again.',
        message: null,
      }
    }
    return { session: data.session, error: null, message: null }
  } catch (error) {
    return { session: null, error: getAuthErrorMessage(error), message: null }
  }
}

export async function signUpWithPassword(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<AuthActionResult> {
  const validationError = validateSignUpInput(email, password)
  if (validationError) {
    return { session: null, error: validationError, message: null }
  }

  try {
    const { data, error } = await client.auth.signUp({
      email: email.trim(),
      password,
    })
    if (error) {
      return { session: null, error: getAuthErrorMessage(error), message: null }
    }
    return {
      session: data.session,
      error: null,
      message: data.session
        ? null
        : 'Account request received. Check your email and confirm your address if required before signing in.',
    }
  } catch (error) {
    return { session: null, error: getAuthErrorMessage(error), message: null }
  }
}

export async function signOut(
  client: SupabaseClient,
): Promise<string | null> {
  try {
    const { error } = await client.auth.signOut()
    return error ? getAuthErrorMessage(error) : null
  } catch (error) {
    return getAuthErrorMessage(error)
  }
}
