import '../src/note-editor.css'
import { Stack } from 'expo-router'
import { ExpoAuthProvider } from '../src/components/ExpoAuthProvider'
import { ThemeProvider } from '../src/components/ThemeProvider'
import { useAppTheme } from '../src/components/ThemeContext'

export default function RootLayout() {
  return (
    <ExpoAuthProvider>
      <ThemeProvider>
        <ThemedStack />
      </ThemeProvider>
    </ExpoAuthProvider>
  )
}

function ThemedStack() {
  const { colors } = useAppTheme()
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Project Notes' }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Forgot password' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Reset password' }} />
      <Stack.Screen name="diagnostic" options={{ title: 'Expo Foundation' }} />
    </Stack>
  )
}
