import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { addStory, deleteStoryMedia, uploadStoryMedia } from '../services/stories';
import { checkImageSize } from '../utils/imageSize';
import { VIDEO_MAX_SECONDS, isVideoOverLimit, VIDEO_OVER_LIMIT_MESSAGE } from '../utils/videoLimits';
import type { User } from 'firebase/auth';

/** Composition mode for a story.
 *  - `'media'`: the user has picked / will pick a photo or video.
 *  - `'text'`: text-only on a colored gradient background (IG "type" mode). */
export type StoryMode = 'media' | 'text';

export type AddStoryState = {
  text: string;
  setText: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  saving: boolean;
  /** [0, 1] upload progress for media. 0 = no upload in flight, 1 = upload
      complete (Firestore write may still be pending). */
  uploadProgress: number;
  selectedEmoji: string;
  setSelectedEmoji: (v: string) => void;
  mediaUri: string | null;
  setMediaUri: (v: string | null) => void;
  mediaType: 'photo' | 'video' | null;
  setMediaType: (v: 'photo' | 'video' | null) => void;
  /** Current composition mode — `'media'` by default; `'text'` when the user
      explicitly chose a text-only story from the empty-state picker. */
  mode: StoryMode;
  setMode: (m: StoryMode) => void;
  pickMedia: (source: 'library' | 'camera', type: 'photo' | 'video') => Promise<void>;
  handlePost: () => Promise<void>;
  /** Wipes all in-progress draft state (text/location/media/emoji/mode) without
      posting. The composer calls this when the user confirms "Discard draft?"
      — otherwise the hook's state persists across modal closes and silently
      pre-fills the next compose session. */
  reset: () => void;
};

const DEFAULT_EMOJI = '🎣';

export function useAddStory(
  user: Pick<User, 'uid' | 'displayName' | 'photoURL'> | null,
  onSuccess: () => void,
  onClose: () => void,
): AddStoryState {
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  // Synchronous double-tap guard. `saving` state lags one render so two
  // rapid taps both see `saving=false` and both invoke handlePost. With
  // network latency in between, the second invocation can fire its own
  // upload before the first finishes — two stories posted, two storage
  // files written. Same pattern as PostCard / AddCatch / NewSpotModal.
  const savingRef = useRef(false);
  const [selectedEmoji, setSelectedEmoji] = useState(DEFAULT_EMOJI);
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'photo' | 'video' | null>(null);
  const [mode, setMode] = useState<StoryMode>('media');

  const reset = useCallback(() => {
    setText('');
    setLocation('');
    setMediaUri(null);
    setMediaType(null);
    setSelectedEmoji(DEFAULT_EMOJI);
    setMode('media');
    setUploadProgress(0);
  }, []);

  const pickMedia = async (source: 'library' | 'camera', type: 'photo' | 'video') => {
    try {
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: type === 'video' ? 'videos' : 'images',
        quality: type === 'video' ? 0.8 : 0.85,
        // 15-second cap — matches the feed-video limit, keeps stories
        // ephemeral and skimmable, and bounds upload size. videoMaxDuration
        // is iOS-only in expo-image-picker; the post-pick duration check
        // below catches Android (and any iOS edge cases like a 16s video
        // produced by a fractional-second rounding error).
        videoMaxDuration: VIDEO_MAX_SECONDS,
        allowsEditing: type === 'photo',
        // Force a 9:16 crop on photos so the composer canvas isn't letterboxed
        // for landscape captures. Stories are conventionally vertical (IG,
        // Snap, TikTok); a landscape photo cropped on-pick reads correctly
        // both in the composer preview and the viewer.
        aspect: type === 'photo' ? [9, 16] : undefined,
        // Transcode picked / captured videos to 720p H.264 before upload.
        // Without this, the picker hands back the raw asset URI — which on a
        // modern iPhone is 1080p (or 4K if the camera is in 4K mode). A 60s
        // 1080p clip is ~80 MB; the same clip at 720p is ~12 MB. The huge
        // raw file was the primary reason stories took 5-15s to start
        // playing on mobile data (story videos are short ephemeral content
        // — 720p is more than enough quality for a phone-screen overlay).
        // iOS-only — on Android the picker doesn't transcode; we live with
        // the larger upload there. To compress on Android too we'd need a
        // separate library like react-native-compressor.
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      };
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Достъп', 'Разреши достъп до камерата.'); return; }
        result = await ImagePicker.launchCameraAsync(opts);
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          // Library denial was previously silent — user tapped a picker row,
          // got nothing, no signal why. Match the camera-permission UX so the
          // user knows to flip the setting in iOS / Android settings.
          Alert.alert('Достъп', 'Разреши достъп до снимките в настройките.');
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync(opts);
      }
      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        // Photos use the standard 10 MB cap; videos rely on the storage rule's
        // 100 MB cap since most clips under 15s fit comfortably.
        if (type === 'photo' && !checkImageSize(asset)) return;
        if (type === 'video') {
          // Android's picker doesn't honour videoMaxDuration, and iOS can hand
          // back a clip a fraction over the limit when a user rounds-up trim
          // handles. Reject anything over the cap (with rounding tolerance)
          // so we never upload a story that the viewer can't display in
          // its 15s window.
          const durationMs = typeof asset.duration === 'number' ? asset.duration : 0;
          if (isVideoOverLimit(durationMs)) {
            Alert.alert('Твърде дълго видео', VIDEO_OVER_LIMIT_MESSAGE);
            return;
          }
        }
        setMediaUri(asset.uri);
        setMediaType(type);
        setMode('media');
      }
    } catch { Alert.alert('Грешка', 'Неуспешно избиране на медия.'); }
  };

  const handlePost = async () => {
    if (!user || savingRef.current) return;
    if (!text.trim() && !mediaUri) { Alert.alert('Добави съдържание', 'Напиши нещо или добави снимка/видео.'); return; }
    savingRef.current = true;
    setSaving(true);
    setUploadProgress(0);
    // Track the uploaded media's storage path so we can clean it up if the
    // subsequent addStory write fails. Without this, a failed Firestore
    // write (rules reject, rate limit, network blip) leaves the media file
    // orphaned in stories/{uid}/ forever — no doc references it and the
    // expired-stories cleanup function only walks docs, never standalone
    // storage files.
    let uploadedPath: string | undefined;
    try {
      let uploadedUrl: string | undefined;
      if (mediaUri && mediaType) {
        const result = await uploadStoryMedia(mediaUri, user.uid, mediaType, (p) => {
          setUploadProgress(p);
        });
        uploadedUrl = result.url;
        uploadedPath = result.storagePath;
      }
      try {
        await addStory({
          uid: user.uid,
          userName: user.displayName?.split(' ')[0] ?? 'Рибар',
          userPhotoUrl: user.photoURL ?? undefined,
          text: text.trim(),
          locationName: location.trim() || undefined,
          emoji: selectedEmoji,
          mediaUrl: uploadedUrl,
          mediaType: mediaType ?? undefined,
        });
      } catch (e) {
        // addStory failed AFTER the upload succeeded — delete the orphan.
        if (uploadedPath) {
          void deleteStoryMedia(uploadedPath);
        }
        throw e;
      }
      reset();
      onClose();
      onSuccess();
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally {
      savingRef.current = false;
      setSaving(false);
      setUploadProgress(0);
    }
  };

  return {
    text, setText, location, setLocation, saving, uploadProgress,
    selectedEmoji, setSelectedEmoji,
    mediaUri, setMediaUri, mediaType, setMediaType,
    mode, setMode,
    pickMedia, handlePost, reset,
  };
}
