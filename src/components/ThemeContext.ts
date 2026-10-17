import { createContext, useContext } from 'react'

export type AppTheme = 'light' | 'dark'

export function resolveAppTheme(
  preference: string | null,
  systemTheme: string | null,
): AppTheme {
  if (preference === 'light' || preference === 'dark') return preference
  return systemTheme === 'dark' ? 'dark' : 'light'
}

export type ThemeColors = {
  background: string
  surface: string
  surfaceMuted: string
  border: string
  text: string
  mutedText: string
  accent: string
  accentText: string
  input: string
  errorBackground: string
  errorText: string
  successBackground: string
  successText: string
  infoBackground: string
  infoText: string
  blueBackground: string
  blueBorder: string
  focus: string
  disabledOpacity: number
}

export const themeColors: Record<AppTheme, ThemeColors> = {
  light: {
    background: '#f6f3f8', surface: '#ffffff', surfaceMuted: '#faf9fb',
    border: '#e1dbe7', text: '#30283d', mutedText: '#62596b',
    accent: '#69448a', accentText: '#69448a', input: '#ffffff',
    errorBackground: '#fff0ef', errorText: '#8b2424',
    successBackground: '#edf6ee', successText: '#345b3b',
    infoBackground: '#f1edf5', infoText: '#443b50',
    blueBackground: '#eff7ff', blueBorder: '#9cc9ef',
    focus: '#7950a0', disabledOpacity: 0.55,
  },
  dark: {
    background: '#15131a', surface: '#211e28', surfaceMuted: '#292531',
    border: '#494252', text: '#f3eef8', mutedText: '#c2b9cd',
    accent: '#c3a2e3', accentText: '#d5b8f2', input: '#1b1821',
    errorBackground: '#442728', errorText: '#ffc4c4',
    successBackground: '#263d2d', successText: '#c1ecc8',
    infoBackground: '#30283a', infoText: '#e3d8ef',
    blueBackground: '#172d40', blueBorder: '#4585b6',
    focus: '#cfaaef', disabledOpacity: 0.5,
  },
}

export type ThemeContextValue = {
  theme: AppTheme
  colors: ThemeColors
  toggleTheme: () => void
  preferenceError: string
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useAppTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useAppTheme must be used inside ThemeProvider.')
  return value
}
