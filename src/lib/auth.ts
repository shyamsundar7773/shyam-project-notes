import type {
  AuthChangeEvent,
  SupabaseClient,
} from '@supabase/supabase-js'
import { getAuthErrorMessage } from './phase1'

export function passwordRecoveryRedirect(origin: string): string {
  return new URL('/reset-password', origin).toString()
}

export function recoveryModeAfterAuthEvent(
  current: boolean,
  event: AuthChangeEvent,
  hasSession: boolean,
): boolean {
  if (event === 'PASSWORD_RECOVERY') return hasSession
  if (event === 'SIGNED_OUT') return false
  return current
}

export function passwordRecoveryLinkError(
  search: string,
  hash = '',
): string | null {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.replace(/^#/, ''))
  const code =
    query.get('error_code') ??
    query.get('error') ??
    fragment.get('error_code') ??
    fragment.get('error')

  if (
    code === 'otp_expired' ||
    code === 'access_denied' ||
    code === 'flow_state_expired' ||
    code === 'invalid_request'
  ) {
    return 'This password recovery link is expired or invalid. Request a new one.'
  }
  return null
}

export function validateEmailInput(email: string): string | null {
  const value = email.trim()
  if (!value) return 'Enter your email address.'
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(value)) {
    return 'Enter a valid email address.'
  }
  return null
}

export function validatePasswordInput(password: string): string | null {
  if (!password) return 'Enter your password.'
  return null
}

export function validateNewPassword(
  password: string,
  confirmation: string,
): string | null {
  if (!password) return 'Enter a new password.'
  if (password.length < 8) {
    return 'Use a password with at least 8 characters.'
  }
  if (password !== confirmation) return 'The passwords do not match.'
  return null
}

export async function updatePasswordFromRecovery(
  client: Pick<SupabaseClient, 'auth'>,
  hasRecoverySession: boolean,
  password: string,
  confirmation: string,
): Promise<string | null> {
  if (!hasRecoverySession) {
    return 'A valid password recovery session is required. Request a new recovery email.'
  }
  const validationError = validateNewPassword(password, confirmation)
  if (validationError) return validationError

  try {
    const { error } = await client.auth.updateUser({ password })
    return error ? getAuthErrorMessage(error) : null
  } catch (error) {
    return getAuthErrorMessage(error)
  }
}
