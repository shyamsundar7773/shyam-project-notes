export function canInitializeExpoSupabase(
  platform: string,
  hasBrowserWindow: boolean,
): boolean {
  return platform !== 'web' || hasBrowserWindow
}
