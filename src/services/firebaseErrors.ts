export function formatFirebaseError(e: unknown): string {
  if (e && typeof e === 'object' && 'code' in e && 'message' in e) {
    const o = e as { code?: string; message?: string };
    return [o.code, o.message].filter(Boolean).join(': ');
  }
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
