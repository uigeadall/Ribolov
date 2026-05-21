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
      };
      let result: ImagePicker.ImagePickerResult;
      if (source === 'camera') {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { Alert.alert('Достъ��', 'Разреши достъп до камерата.'); return; }
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
    if (!text.trim() && !mediaUri) { Alert.alert('Добави съдържание', 'Напиши нещо или д��бави снимка/видео.'); return; }
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
