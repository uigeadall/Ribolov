import Toast from 'react-native-toast-message';

/** Non-blocking notification helpers. Use these for informational feedback
    (success, error, validation messages) instead of `Alert.alert`. Reserve
    `Alert.alert` for actual confirmations the user must explicitly acknowledge
    or dismiss — destructive actions, multi-step prompts, permission re-asks.

    Why a wrapper: keeps Toast call sites short, enforces consistent visibility
    duration, and gives us one place to swap libraries later if we ever want to. */

const DEFAULT_VISIBILITY_MS = 2_500;
const ERROR_VISIBILITY_MS = 3_500;

/** Brief positive confirmation — "Записано", "Изпратено", etc. */
export function notifySuccess(text1: string, text2?: string): void {
  Toast.show({
    type: 'success',
    text1,
    text2,
    visibilityTime: DEFAULT_VISIBILITY_MS,
  });
}

/** Non-blocking error — lets the user know something failed without modal interruption.
    Use when the error is recoverable / understood. Keep `Alert.alert` for errors that
    need the user to make a decision. */
export function notifyError(text1: string, text2?: string): void {
  Toast.show({
    type: 'error',
    text1,
    text2,
    visibilityTime: ERROR_VISIBILITY_MS,
  });
}

/** Neutral informational toast — validation hints, "offline, will sync later", etc. */
export function notifyInfo(text1: string, text2?: string): void {
  Toast.show({
    type: 'info',
    text1,
    text2,
    visibilityTime: DEFAULT_VISIBILITY_MS,
  });
}
