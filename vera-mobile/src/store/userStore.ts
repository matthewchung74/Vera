import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

interface UserState {
  userId: string | null;
  isInitialized: boolean;
  initialize: () => Promise<void>;
}

export const useUserStore = create<UserState>((set, get) => ({
  userId: null,
  isInitialized: false,

  initialize: async () => {
    // Skip if already initialized
    if (get().isInitialized) return;

    try {
      let userId = await SecureStore.getItemAsync('vera_user_id');
      if (!userId) {
        userId = Crypto.randomUUID();
        await SecureStore.setItemAsync('vera_user_id', userId);
        console.log('[USER] Generated new user ID:', userId);
      } else {
        console.log('[USER] Loaded existing user ID:', userId);
      }
      set({ userId, isInitialized: true });
    } catch (error) {
      console.error('[USER] Failed to initialize user ID:', error);
      // Fall back to in-memory UUID if secure store fails
      const fallbackId = Crypto.randomUUID();
      set({ userId: fallbackId, isInitialized: true });
    }
  },
}));
