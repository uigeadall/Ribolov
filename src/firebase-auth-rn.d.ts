export {};

declare module 'firebase/auth' {
  export function getReactNativePersistence(
    storage: import('@react-native-async-storage/async-storage').AsyncStorageStatic
  ): import('firebase/auth').Persistence;
}
