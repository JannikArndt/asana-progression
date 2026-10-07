/** Random id (RFC 4122 v4 when available). */
export function newId(prefix = ''): string {
  const c = globalThis.crypto;
  const uuid =
    typeof c?.randomUUID === 'function'
      ? c.randomUUID()
      : Array.from(c.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
  return prefix ? `${prefix}_${uuid}` : uuid;
}
