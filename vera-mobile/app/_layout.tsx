import { registerGlobals } from '@livekit/react-native';

registerGlobals();

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

export default function RootLayout() {
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
        <Stack.Screen
          name="admin"
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Admin',
          }}
        />
      </Stack>
    </View>
  );
}
