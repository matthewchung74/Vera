import { registerGlobals } from '@livekit/react-native';

registerGlobals();

import { useEffect } from 'react';
import { Stack, useRouter, useSegments, useRootNavigation } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { useAuthStore } from '../src/store/authStore';
import { useUserStore } from '../src/store/userStore';
import LoadingIndicator from '../src/components/LoadingIndicator';

export default function RootLayout() {
  const { isAuthenticated, isLoading, checkAuth } = useAuthStore();
  const { initialize: initializeUser } = useUserStore();
  const segments = useSegments();
  const router = useRouter();
  const rootNavigation = useRootNavigation();

  useEffect(() => {
    // Initialize user ID and check auth in parallel
    Promise.all([initializeUser(), checkAuth()]);
  }, []);

  useEffect(() => {
    // Wait for auth check and navigation to be ready
    if (isLoading) return;
    if (!rootNavigation?.isReady()) return;

    const onLoginScreen = segments[0] === 'login';

    if (!isAuthenticated && !onLoginScreen) {
      router.replace('/login');
    } else if (isAuthenticated && onLoginScreen) {
      router.replace('/');
    }
  }, [isAuthenticated, isLoading, segments, rootNavigation?.isReady()]);

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FAF5EB' },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen
          name="admin"
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Admin',
          }}
        />
      </Stack>
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <LoadingIndicator message="Checking account..." />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FAF5EB',
  },
});
