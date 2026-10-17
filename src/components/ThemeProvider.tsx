import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { Pressable, Text, useColorScheme } from 'react-native'
import { resolveAppTheme, ThemeContext, themeColors, type AppTheme, useAppTheme } from './ThemeContext'

const themeStorageKey = 'shyam-project-notes:theme'

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemTheme = useColorScheme()
  const [preference, setPreference] = useState<AppTheme | null>(null)
  const [preferenceError, setPreferenceError] = useState('')
  const userSelectedTheme = useRef(false)

  useEffect(() => {
    let active = true
    void AsyncStorage.getItem(themeStorageKey)
      .then((stored) => {
        if (active && !userSelectedTheme.current && (stored === 'light' || stored === 'dark')) {
          setPreference(stored)
        }
      })
      .catch(() => {
        if (active) setPreferenceError('Theme preference could not be loaded; using the system theme.')
      })
    return () => {
      active = false
    }
  }, [])

  const theme = resolveAppTheme(preference, systemTheme)
  const toggleTheme = useCallback(() => {
    const next: AppTheme = theme === 'dark' ? 'light' : 'dark'
    userSelectedTheme.current = true
    setPreference(next)
    setPreferenceError('')
    void AsyncStorage.setItem(themeStorageKey, next).catch(() => {
      setPreferenceError('Theme changed for this session but could not be saved.')
    })
  }, [theme])
  const value = useMemo(
    () => ({ theme, colors: themeColors[theme], toggleTheme, preferenceError }),
    [theme, toggleTheme, preferenceError],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function ThemeToggle() {
  const { theme, colors: palette, toggleTheme, preferenceError } = useAppTheme()
  const nextTheme = theme === 'dark' ? 'Light' : 'Dark'
  return (
    <Pressable
      accessibilityLabel={`Switch to ${nextTheme} mode`}
      accessibilityRole="button"
      accessibilityHint={preferenceError || `Current theme: ${theme}.`}
      onPress={toggleTheme}
      style={({ pressed }) => ({
        alignItems: 'center',
        backgroundColor: palette.surface,
        borderColor: palette.border,
        borderRadius: 999,
        borderWidth: 1,
        height: 44,
        justifyContent: 'center',
        minWidth: 44,
        paddingHorizontal: 12,
        flexDirection: 'row',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text accessibilityElementsHidden style={{ color: palette.text }}>
        {theme === 'dark' ? '☾' : '☀'}
      </Text>
      <Text style={{ color: palette.text, marginLeft: 6 }}>{nextTheme}</Text>
      {preferenceError ? <Text accessibilityRole="alert" style={{ color: palette.errorText, marginLeft: 8 }}>!</Text> : null}
    </Pressable>
  )
}
