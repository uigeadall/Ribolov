import Constants from 'expo-constants';

export type CloudinaryConfig = { cloudName: string; uploadPreset: string };

export function getCloudinaryUploadConfig(): CloudinaryConfig | null {
  const e = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  const cloudName = e.cloudinaryCloudName?.trim();
  const uploadPreset = e.cloudinaryUploadPreset?.trim();
  if (!cloudName || !uploadPreset) return null;
  return { cloudName, uploadPreset };
}

export async function uploadImageToCloudinary(
  uri: string,
  cloudName: string,
  uploadPreset: string
): Promise<{ secureUrl: string; publicId: string }> {
  const form = new FormData();
  form.append('file', { uri, type: 'image/jpeg', name: 'photo.jpg' } as unknown as Blob);
  form.append('upload_preset', uploadPreset);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Cloudinary: ${res.status}`);
  const data = (await res.json()) as { secure_url: string; public_id: string };
  return { secureUrl: data.secure_url, publicId: data.public_id };
}
