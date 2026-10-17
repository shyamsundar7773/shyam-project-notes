import { useRef, useState } from 'react'
import { Link, type Href } from 'expo-router'
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { signInWithPassword, signUpWithPassword } from '../lib/expo-auth'
import { useExpoAuth } from './ExpoAuthContext'
import { ExpoScreen } from './ExpoScreen'
import { screenStyles } from './expo-screen-styles'

export function ExpoAuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const { client, configuration, restorationError, clearRestorationError } =
    useExpoAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
    clearRestorationError()

    const result =
      mode === 'sign-in'
        ? await signInWithPassword(client, email, password)
        : await signUpWithPassword(client, email, password)
    setError(result.error ?? '')
    setMessage(result.message ?? '')
    submissionLock.current = false
    setBusy(false)
  }

  if (!client) {
    return (
      <ExpoScreen scroll>
        <View style={screenStyles.card}>
          <Text style={screenStyles.eyebrow}>SETUP REQUIRED</Text>
          <Text style={screenStyles.title}>Connect Supabase</Text>
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            {configuration.message}
          </Text>
          <Text style={screenStyles.body}>
            Only the public project URL and publishable key belong in Expo
            frontend configuration.
          </Text>
        </View>
      </ExpoScreen>
    )
  }

  return (
    <ExpoScreen scroll>
      <View style={screenStyles.card}>
        <Text style={screenStyles.eyebrow}>YOUR PRIVATE LEARNING SPACE</Text>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
        </Text>
        <Text style={screenStyles.body}>
          {mode === 'sign-in'
            ? 'Sign in to view your project files and learning topics.'
            : 'Create an account to organize your learning workspace.'}
        </Text>

        {restorationError ? (
          <Text accessibilityRole="alert" style={[screenStyles.notice, screenStyles.errorNotice]}>
            {restorationError}
          </Text>
        ) : null}
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
          <Text nativeID="expo-email-label" style={screenStyles.fieldLabel}>
            Email
          </Text>
          <TextInput
            accessibilityLabel="Email"
            accessibilityLabelledBy="expo-email-label"
            autoCapitalize="none"
            autoComplete="email"
            autoCorrect={false}
            keyboardType="email-address"
            maxLength={254}
            onChangeText={setEmail}
            onSubmitEditing={() => {
              if (mode === 'sign-in') void submit()
            }}
            placeholder="you@example.com"
            returnKeyType={mode === 'sign-in' ? 'go' : 'next'}
            style={screenStyles.input}
            textContentType="emailAddress"
            value={email}
          />
        </View>
        <View style={styles.field}>
          <Text nativeID="expo-password-label" style={screenStyles.fieldLabel}>
            Password
          </Text>
          <TextInput
            accessibilityLabel="Password"
            accessibilityLabelledBy="expo-password-label"
            autoCapitalize="none"
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            placeholder={mode === 'sign-in' ? 'Enter your password' : 'At least 6 characters'}
            returnKeyType="go"
            secureTextEntry
            style={screenStyles.input}
            textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
            value={password}
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
            {busy
              ? mode === 'sign-in'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'sign-in'
                ? 'Sign in'
                : 'Create account'}
          </Text>
        </Pressable>

        {mode === 'sign-in' ? (
          <Link href={'/forgot-password' as Href} asChild>
            <Pressable accessibilityRole="link" style={screenStyles.secondaryButton}>
              <Text style={screenStyles.secondaryText}>Forgot password?</Text>
            </Pressable>
          </Link>
        ) : null}

        <Link
          href={(mode === 'sign-in' ? '/sign-up' : '/sign-in') as Href}
          asChild
        >
          <Pressable accessibilityRole="link" style={screenStyles.secondaryButton}>
            <Text style={screenStyles.secondaryText}>
              {mode === 'sign-in'
                ? 'Create an account'
                : 'Already have an account? Sign in'}
            </Text>
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
