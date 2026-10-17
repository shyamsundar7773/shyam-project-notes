import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export function resolveFrontendEnvironment(
  env: Record<string, string | undefined>,
) {
  return {
    supabaseUrl:
      env.VITE_SUPABASE_URL ||
      env.EXPO_PUBLIC_SUPABASE_URL ||
      '',
    supabasePublishableKey:
      env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      '',
    backendUrl: env.VITE_BACKEND_URL ?? '',
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const frontendEnvironment = resolveFrontendEnvironment(env)

  return {
    plugins: [react()],
    envPrefix: [],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
        frontendEnvironment.supabaseUrl,
      ),
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(
        frontendEnvironment.supabasePublishableKey,
      ),
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(
        frontendEnvironment.backendUrl,
      ),
    },
  }
})
