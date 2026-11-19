/**
 * Settings that describe the device or the local seed and sync state: never exported, imported
 * or synced to the server.
 */
export function isDeviceSetting(key: string): boolean {
  return (
    key === 'persistRequested' ||
    key === 'persistGranted' ||
    key === 'catalogVersion' ||
    key.startsWith('diag.') ||
    key.startsWith('backup.') ||
    key.startsWith('sync.')
  );
}
