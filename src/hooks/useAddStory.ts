import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { addStory, uploadStoryMedia } from '../services/stories';
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
  const [selectedEmoji, setSelectedEmoji] = useState('🎣');
  const [mediaUri, setMediaUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'photo' | 'video' | null>(null);

  const pickMedia = async (source: 'library' | 'camera', type: 'photo' | 'video') => {
    try {
      const opts: ImagePicker.ImagePickerOptions = {
        mediaTypes: type === 'video' ? ImagePicker.MediaType.Videos : ImagePicker.MediaType.Images,
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
        setMediaUri(result.assets[0].uri);
        setMediaType(type);
      }
    } catch { Alert.alert('Грешка', 'Неуспешно избиране на медия.'); }
  };

  const handlePost = async () => {
    if (!user) return;
    if (!text.trim() && !mediaUri) { Alert.alert('Добави съдържание', 'Напиши нещо или д��бави снимка/видео.'); return; }
    setSaving(true);
    try {
      let uploadedUrl: string | undefined;
      if (mediaUri && mediaType) uploadedUrl = await uploadStoryMedia(mediaUri, user.uid, mediaType);
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
      setText('');
      setLocation('');
      setMediaUri(null);
      setMediaType(null);
      onClose();
      onSuccess();
    } catch (e: unknown) {
      Alert.alert('Грешка', e instanceof Error ? e.message : 'Неуспешно изпращане.');
    } finally { setSaving(false); }
  };

  return {
    text, setText, location, setLocation, saving,
    selectedEmoji, setSelectedEmoji,
    mediaUri, setMediaUri, mediaType, setMediaType,
    pickMedia, handlePost,
  };
}
