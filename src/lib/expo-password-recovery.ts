import type { Session, SupabaseClient } from '@supabase/supabase-js'
import {
  passwordRecoveryLinkError,
  updatePasswordFromRecovery,
  validateEmailInput,
} from './auth'
import { getAuthErrorMessage } from './phase1'

export const recoveryEmailSentMessage =
  'If an account can receive password recovery for this address, instructions will be sent to its email.'

export function expoRecoveryRedirectUrl(
  isExpoGo: boolean,
  linkingUri: string,
  createURL: (path: string) => string,
): string {
  if (!isExpoGo) return createURL('/reset-password')

  const runtime = new URL(linkingUri)
  if (!runtime.host) {
    throw new Error('The Expo Go runtime URL is unavailable.')
  }
  return `${runtime.protocol}//${runtime.host}/--/reset-password`
}

export function hasPasswordRecoveryCallback(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''))
    return Boolean(
      parsed.searchParams.get('code') ||
        parsed.searchParams.get('error') ||
        parsed.searchParams.get('error_code') ||
        hash.get('type') === 'recovery' ||
        (hash.get('access_token') && hash.get('refresh_token')) ||
        hash.get('error') ||
        hash.get('error_code'),
    )
  } catch {
    return false
  }
}

export function passwordRecoveryCallbackError(url: string): string | null {
  try {
    const parsed = new URL(url)
    return passwordRecoveryLinkError(parsed.search, parsed.hash)
  } catch {
    return 'This password recovery link is invalid. Request a new one.'
  }
}

export async function requestExpoPasswordRecovery(
  client: Pick<SupabaseClient, 'auth'>,
  email: string,
  redirectTo: string,
): Promise<{ error: string | null; message: string | null }> {
  const validationError = validateEmailInput(email)
  if (validationError) return { error: validationError, message: null }

  try {
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    })
    return error
      ? { error: getAuthErrorMessage(error), message: null }
      : { error: null, message: recoveryEmailSentMessage }
  } catch (error) {
    return { error: getAuthErrorMessage(error), message: null }
  }
}

export async function establishExpoRecoverySession(
  client: Pick<SupabaseClient, 'auth'>,
  url: string,
): Promise<{ session: Session | null; error: string | null }> {
  const callbackError = passwordRecoveryCallbackError(url)
  if (callbackError) return { session: null, error: callbackError }

  try {
    const parsed = new URL(url)
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''))
    const accessToken = hash.get('access_token')
    const refreshToken = hash.get('refresh_token')
    const result =
      hash.get('type') === 'recovery' && accessToken && refreshToken
        ? await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
        : null

    if (!result) {
      return {
        session: null,
        error:
          'This link did not establish a password recovery session. Request a fresh recovery email.',
      }
    }
    if (result.error) {
      return {
        session: null,
        error:
          'This password recovery link is expired or invalid. Request a fresh recovery email.',
      }
    }
    if (!result.data.session) {
      return {
        session: null,
        error:
          'This link did not establish a password recovery session. Request a fresh recovery email.',
      }
    }
    return { session: result.data.session, error: null }
  } catch {
    return {
      session: null,
      error:
        'This password recovery link is expired or invalid. Request a fresh recovery email.',
    }
  }
}

export { updatePasswordFromRecovery }
