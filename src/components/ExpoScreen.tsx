import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import type { PropsWithChildren } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { screenStyles } from './expo-screen-styles'
import { useAppTheme } from './ThemeContext'

export function ExpoScreen({
  children,
  scroll = false,
}: PropsWithChildren<{ scroll?: boolean }>) {
  const { colors } = useAppTheme()
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={styles.centerContent}>{children}</View>
  )

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

export function LoadingScreen({ label }: { label: string }) {
  const { colors } = useAppTheme()
  return (
    <ExpoScreen>
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text accessibilityLiveRegion="polite" style={screenStyles.body}>
          {label}
        </Text>
      </View>
    </ExpoScreen>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: '#f6f3f8',
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
  },
  centerContent: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  loading: {
    alignItems: 'center',
    gap: 16,
  },
})
