import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

// SecureStore is preferred for normal-sized auth sessions. Supabase sessions
// can occasionally exceed platform secure-storage limits, so AsyncStorage is
// retained as a fallback for unusually large values.
const SECURE_LIMIT = 1800;

export const authStorage = {
  async getItem(key) {
    try {
      const secureValue = await SecureStore.getItemAsync(key);
      if (secureValue !== null) return secureValue;
    } catch (_) {}
    return AsyncStorage.getItem(key);
  },
  async setItem(key, value) {
    if (value.length <= SECURE_LIMIT) {
      try {
        await SecureStore.setItemAsync(key, value);
        await AsyncStorage.removeItem(key);
        return;
      } catch (_) {}
    }
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key) {
    await Promise.all([
      SecureStore.deleteItemAsync(key).catch(() => {}),
      AsyncStorage.removeItem(key).catch(() => {})
    ]);
  }
};
