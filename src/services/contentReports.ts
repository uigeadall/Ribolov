import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { ensureFirebase } from './firebase';
import { stripUndefinedForFirestore } from './firestoreSanitize';
import { captureException } from './observability';

export type ReportTargetType = 'catch' | 'comment';

export async function submitContentReport(opts: {
  reporterUid: string;
  targetType: ReportTargetType;
  /** catch id за поста; при коментар — същият catch id */
  catchId: string;
  commentId?: string;
  reason: string;
}): Promise<void> {
  const fb = ensureFirebase();
  if (!fb) throw new Error('Firebase не е наличен.');
  const reason = opts.reason.trim().slice(0, 500);
  if (reason.length < 3) throw new Error('Посочи поне няколко думи за причината.');

  try {
    await addDoc(
      collection(fb.db, 'contentReports'),
      stripUndefinedForFirestore({
        reporterUid: opts.reporterUid,
        targetType: opts.targetType,
        catchId: opts.catchId.slice(0, 128),
        commentId: opts.commentId?.slice(0, 128),
        reason,
        createdAt: serverTimestamp(),
      })
    );
  } catch (e) {
    captureException(e, { area: 'content_report' });
    throw e;
  }
}
