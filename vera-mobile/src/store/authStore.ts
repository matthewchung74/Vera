import { create } from 'zustand';
import {
  isGmailConnected,
  isOutlookConnected,
  disconnectGmail,
  disconnectOutlook,
} from '../services/authService';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  isLoading: true,

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const [gmail, outlook] = await Promise.all([
        isGmailConnected(),
        isOutlookConnected(),
      ]);
      set({ isAuthenticated: gmail || outlook, isLoading: false });
    } catch (error) {
      console.error('Auth check error:', error);
      set({ isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await Promise.all([disconnectGmail(), disconnectOutlook()]);
      set({ isAuthenticated: false, isLoading: false });
    } catch (error) {
      console.error('Logout error:', error);
      set({ isLoading: false });
    }
  },
}));
