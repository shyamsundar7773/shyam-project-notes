import { useEffect, useRef, useState } from 'react'
import { useLinkingURL } from 'expo-linking'
import { Link, router, type Href } from 'expo-router'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useExpoAuth } from '../src/components/ExpoAuthContext'
import { ExpoScreen, LoadingScreen } from '../src/components/ExpoScreen'
import { screenStyles } from '../src/components/expo-screen-styles'
import {
  establishExpoRecoverySession,
  hasPasswordRecoveryCallback,
  updatePasswordFromRecovery,
} from '../src/lib/expo-password-recovery'

const freshLinkMessage =
  'This password recovery link is expired, invalid, or missing. Request a fresh recovery email from the sign-in screen.'

export default function ResetPasswordScreen() {
  const {
    client,
    configuration,
    loading,
    session,
    recoverySessionActive,
    setRecoverySessionActive,
  } = useExpoAuth()
  const url = useLinkingURL()
  const [checking, setChecking] = useState(true)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [callbackError, setCallbackError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [complete, setComplete] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const submissionLock = useRef(false)
  const processedUrl = useRef('')

  useEffect(() => {
    if (loading) return
    let active = true
    void Promise.resolve().then(async () => {
      if (!active) return
      if (!client) {
        setChecking(false)
        return
      }
      if (recoverySessionActive && session) {
        setRecoveryReady(true)
        setCallbackError('')
        setChecking(false)
        return
      }
      if (!url || processedUrl.current === url) {
        setRecoveryReady(false)
        setCallbackError(freshLinkMessage)
        setChecking(false)
        return
      }

      processedUrl.current = url
      if (!hasPasswordRecoveryCallback(url)) {
        setRecoveryReady(false)
        setCallbackError(freshLinkMessage)
        setChecking(false)
        return
      }

      setChecking(true)
      const result = await establishExpoRecoverySession(client, url)
      if (!active) return
      if (result.session) {
        setRecoverySessionActive(true)
        setRecoveryReady(true)
        setCallbackError('')
        router.replace('/reset-password' as Href)
      } else {
        setRecoveryReady(false)
        setCallbackError(result.error ?? freshLinkMessage)
      }
      setChecking(false)
    })

    return () => {
      active = false
    }
  }, [
    client,
    loading,
    recoverySessionActive,
    session,
    setRecoverySessionActive,
    url,
  ])

  async function submit() {
    if (
      submissionLock.current ||
      !client ||
      !recoveryReady ||
      !recoverySessionActive ||
      !session
    ) {
      return
    }
    submissionLock.current = true
    setBusy(true)
    setError('')
    try {
      const updateError = await updatePasswordFromRecovery(
        client,
        recoverySessionActive && session !== null,
        password,
        confirmation,
      )
      if (updateError) {
        setError(updateError)
      } else {
        setComplete(true)
      }
    } finally {
      submissionLock.current = false
      setBusy(false)
    }
  }

  async function returnToSignIn() {
    if (!client || busy) return
    setSignOutError('')
    try {
      const { error: authError } = await client.auth.signOut({ scope: 'local' })
      if (authError) {
        setSignOutError(
          'Your password was updated, but this recovery session could not be cleared. Try again before signing in.',
        )
        return
      }
      setRecoverySessionActive(false)
      router.replace('/sign-in' as Href)
    } catch {
      setSignOutError(
        'Your password was updated, but this recovery session could not be cleared. Try again before signing in.',
      )
    }
  }

  if (loading || checking) {
    return <LoadingScreen label="Checking your recovery link…" />
  }
  if (!client) {
    return (
      <ExpoScreen scroll>
        <View style={screenStyles.card}>
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            {configuration.message}
          </Text>
        </View>
      </ExpoScreen>
    )
  }
  if (!recoveryReady || !recoverySessionActive || !session) {
    return (
      <ExpoScreen scroll>
        <View style={screenStyles.card}>
          <Text style={screenStyles.eyebrow}>ACCOUNT RECOVERY</Text>
          <Text accessibilityRole="header" style={screenStyles.title}>
            Recovery link unavailable
          </Text>
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            {callbackError || freshLinkMessage}
          </Text>
          <Link href={'/forgot-password' as Href} asChild>
            <Pressable accessibilityRole="link" style={screenStyles.button}>
              <Text style={screenStyles.buttonText}>Request a fresh link</Text>
            </Pressable>
          </Link>
          <Link href={'/sign-in' as Href} asChild>
            <Pressable accessibilityRole="link" style={screenStyles.secondaryButton}>
              <Text style={screenStyles.secondaryText}>Back to sign in</Text>
            </Pressable>
          </Link>
        </View>
      </ExpoScreen>
    )
  }

  return (
    <ExpoScreen scroll>
      <View style={screenStyles.card}>
        <Text style={screenStyles.eyebrow}>ACCOUNT RECOVERY</Text>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {complete ? 'Password updated' : 'Choose a new password'}
        </Text>
        {complete ? (
          <>
            <Text accessibilityLiveRegion="polite" style={[screenStyles.notice, screenStyles.infoNotice]}>
              Your password has been updated. Sign in with the new password.
            </Text>
            {signOutError ? (
              <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
                {signOutError}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => void returnToSignIn()}
              style={screenStyles.button}
            >
              <Text style={screenStyles.buttonText}>Return to sign in</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={screenStyles.body}>
              Choose a password with at least 8 characters and enter it twice.
            </Text>
            {error ? (
              <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
                {error}
              </Text>
            ) : null}
            <View style={styles.field}>
              <Text nativeID="new-password-label" style={screenStyles.fieldLabel}>
                New password
              </Text>
              <TextInput
                accessibilityLabel="New password"
                accessibilityLabelledBy="new-password-label"
                autoCapitalize="none"
                autoComplete="new-password"
                maxLength={256}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                returnKeyType="next"
                secureTextEntry
                style={screenStyles.input}
                textContentType="newPassword"
                value={password}
              />
            </View>
            <View style={styles.field}>
              <Text nativeID="confirm-password-label" style={screenStyles.fieldLabel}>
                Confirm new password
              </Text>
              <TextInput
                accessibilityLabel="Confirm new password"
                accessibilityLabelledBy="confirm-password-label"
                autoCapitalize="none"
                autoComplete="new-password"
                maxLength={256}
                onChangeText={setConfirmation}
                onSubmitEditing={() => void submit()}
                placeholder="Re-enter your new password"
                returnKeyType="go"
                secureTextEntry
                style={screenStyles.input}
                textContentType="newPassword"
                value={confirmation}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={() => void submit()}
              style={({ pressed }) => [
                screenStyles.button,
                busy && screenStyles.buttonDisabled,
                pressed && !busy && styles.pressed,
              ]}
            >
              <Text style={screenStyles.buttonText}>
                {busy ? 'Updating password…' : 'Update password'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </ExpoScreen>
  )
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  pressed: {
    opacity: 0.8,
  },
})
