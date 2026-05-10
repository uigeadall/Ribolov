import { Alert } from 'react-native';
import { captureException } from '../services/observability';
import { formatFirebaseError } from '../services/firebaseErrors';

export function handleError(err: unknown, title = 'Грешка'): void {
  captureException(err);
  Alert.alert(title, formatFirebaseError(err));
}
