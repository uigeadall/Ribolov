import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { addStory, deleteStoryMedia, uploadStoryMedia } from '../services/stories';
import { checkImageSize } from '../utils/imageSize';
import type { User } from 'firebase/auth';

export type AddStoryState = {
  text: string;
  setText: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  saving: boolean;
  selectedEmoji: string;
  setSelectedEmoji: (v: string) => void;
  mediaUri: string | null;
  setMediaUri: (v: string | null) => void;
  mediaType: 'photo' | 'video' | null;
  setMediaType: (v: 'photo' | 'video' | null) => void;
  pickMedia: (source: 'library' | 'camera', type: 'photo' | 'video') => Promise<void>;
  handlePost: () => Promise<void>;
};

export function useAddStory(
  user: Pick<User, 'uid' | 'displayName' | 'photoURL'> | null,
  onSuccess: () => void,
  onClose: () => void,
): AddStoryState {
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);
  // Synchronous double-tap guard. `saving` state lags one render so two
  // rapid taps both see `saving=false` and both invoke handlePost. With
  // network latency in between, the second invocation can fire its own
  // upload before the first finishes — two stories posted, two storage
  // files written. Same pattern as PostCard / AddCatch / NewSpotModal.
  const savingRef = useRef(false);
  const [selectedEmoji, setSelectedEmoji] = useState('🎣');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'photo' | 'video' | null>(null);

  const pickMedia = async (source: 'library' | 'camera', type: 'photo' | 'video') => {
    try {
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: type === 'video' ? 'videos' : 'images',
        quality: type === 'video' ? 0.8 : 0.85,
        videoMaxDuration: 60,
        allowsEditing: type === 'photo',
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
        if (!perm.granted) return;
        result = await ImagePicker.launchImageLibraryAsync(opts);
      }
      if (!result.canceled && result.assets[0]) {
        // Photos use the standard 10 MB cap; videos rely on the storage rule's
        // 100 MB cap since most clips under 60s fit comfortably.
        if (type === 'photo' && !checkImageSize(result.assets[0])) return;
        setMediaUri(result.assets[0].uri);
        setMediaType(type);
      }
    } catch { Alert.alert('Грешка', 'Неуспешно избиране на медия.'); }
  };

  const handlePost = async () => {
    if (!user || savingRef.current) return;
    if (!text.trim() && !mediaUri) { Alert.alert('Добави съдържание', 'Напиши нещо или добави снимка/видео.'); return; }
    savingRef.current = true;
    setSaving(true);
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
        const result = await uploadStoryMedia(mediaUri, user.uid, mediaType);
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
      setText('');
      setLocation('');
      setMediaUri(null);
      setMediaType(null);
      onClose();
      onSuccess();
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return {
    text, setText, location, setLocation, saving,
    selectedEmoji, setSelectedEmoji,
    mediaUri, setMediaUri, mediaType, setMediaType,
    pickMedia, handlePost,
  };
}
