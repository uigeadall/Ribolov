const ERROR_MAP: Record<string, string> = {
  // ── Auth ──────────────────────────────────────────────────────────────────
  'auth/invalid-credential':                   'Невалидни данни за вход. Провери имейла и паролата.',
  'auth/wrong-password':                       'Невалидна парола.',
  'auth/user-not-found':                       'Не е намерен акаунт с този имейл.',
  'auth/email-already-in-use':                 'Имейлът вече се използва от друг акаунт.',
  'auth/weak-password':                        'Паролата трябва да е поне 6 символа.',
  'auth/invalid-email':                        'Невалиден имейл адрес.',
  'auth/too-many-requests':                    'Твърде много неуспешни опити. Изчакай малко и опитай отново.',
  'auth/network-request-failed':               'Няма интернет връзка. Провери мрежата и опитай отново.',
  'auth/user-disabled':                        'Акаунтът е деактивиран. Свържи се с поддръжката.',
  'auth/requires-recent-login':                'За тази операция е нужен повторен вход. Излез и влез отново.',
  'auth/account-exists-with-different-credential': 'Акаунт с този имейл вече съществува с различен метод за вход.',
  'auth/popup-closed-by-user':                 'Влизането беше отменено.',
  'auth/cancelled-popup-request':              'Влизането беше отменено.',
  'auth/operation-not-allowed':                'Тази операция не е разрешена.',
  'auth/expired-action-code':                  'Линкът е изтекъл. Поискай нов.',
  'auth/invalid-action-code':                  'Невалиден линк. Поискай нов.',
  'auth/missing-password':                     'Въведи парола.',
  'auth/missing-email':                        'Въведи имейл адрес.',
  // ── Firestore / RTDB ──────────────────────────────────────────────────────
  'permission-denied':                         'Нямаш права за тази операция.',
  'unavailable':                               'Услугата е временно недостъпна. Опитай отново.',
  'not-found':                                 'Данните не са намерени.',
  'already-exists':                            'Записът вече съществува.',
  'resource-exhausted':                        'Достигнат лимит. Опитай по-късно.',
  'deadline-exceeded':                         'Заявката отне твърде дълго. Провери мрежата.',
  'unauthenticated':                           'Нужен е вход за тази операция.',
};

function extractCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
    return (e as { code: string }).code;
  }
  return null;
}

export function formatFirebaseError(e: unknown): string {
  const code = extractCode(e);
  if (code && ERROR_MAP[code]) return ERROR_MAP[code];
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
