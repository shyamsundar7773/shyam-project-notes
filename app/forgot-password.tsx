import { useRef, useState } from 'react'
import { Link, type Href } from 'expo-router'
import * as Linking from 'expo-linking'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useExpoAuth } from '../src/components/ExpoAuthContext'
import { ExpoScreen } from '../src/components/ExpoScreen'
import { screenStyles } from '../src/components/expo-screen-styles'
import {
  expoRecoveryRedirectUrl,
  requestExpoPasswordRecovery,
} from '../src/lib/expo-password-recovery'

export default function ForgotPasswordScreen() {
  const { client, configuration } = useExpoAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const submissionLock = useRef(false)

  async function submit() {
    if (submissionLock.current || !client) return
    submissionLock.current = true
    setBusy(true)
    setError('')
    setMessage('')

    try {
      const redirectTo = expoRecoveryRedirectUrl(
        Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
        Constants.linkingUri,
        (path) => Linking.createURL(path),
      )
      const result = await requestExpoPasswordRecovery(client, email, redirectTo)
      setError(result.error ?? '')
      setMessage(result.message ?? '')
    } catch {
      setError(
        'Could not prepare the recovery link for this app runtime. Restart the app and try again.',
      )
    } finally {
      submissionLock.current = false
      setBusy(false)
    }
  }

  if (!client) {
    return (
      <ExpoScreen scroll>
        <View style={screenStyles.card}>
          <Text style={screenStyles.eyebrow}>SETUP REQUIRED</Text>
          <Text accessibilityRole="header" style={screenStyles.title}>
            Connect Supabase
          </Text>
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            {configuration.message}
          </Text>
        </View>
      </ExpoScreen>
    )
  }

  return (
    <ExpoScreen scroll>
      <View style={screenStyles.card}>
        <Text style={screenStyles.eyebrow}>ACCOUNT RECOVERY</Text>
        <Text accessibilityRole="header" style={screenStyles.title}>
          Forgot password?
        </Text>
        <Text style={screenStyles.body}>
          Enter your account email and we will send recovery instructions if
          this address can receive them.
        </Text>
        {error ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            {error}
          </Text>
        ) : null}
        {message ? (
          <Text accessibilityLiveRegion="polite" style={[screenStyles.notice, screenStyles.infoNotice]}>
            {message}
          </Text>
        ) : null}
        <View style={styles.field}>
          <Text nativeID="recovery-email-label" style={screenStyles.fieldLabel}>
            Email
          </Text>
          <TextInput
            accessibilityLabel="Email"
            accessibilityLabelledBy="recovery-email-label"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            maxLength={254}
            onChangeText={setEmail}
            onSubmitEditing={() => void submit()}
            placeholder="you@example.com"
            returnKeyType="go"
            style={screenStyles.input}
            textContentType="emailAddress"
            value={email}
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
            {busy ? 'Sending instructions…' : 'Send recovery email'}
          </Text>
        </Pressable>
        <Link href={'/sign-in' as Href} asChild>
          <Pressable accessibilityRole="link" style={screenStyles.secondaryButton}>
            <Text style={screenStyles.secondaryText}>Back to sign in</Text>
          </Pressable>
        </Link>
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
