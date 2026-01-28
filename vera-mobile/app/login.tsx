import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { connectGmail, connectOutlook } from '../src/services/authService';
import { useAuthStore } from '../src/store/authStore';

export default function LoginScreen() {
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingProvider, setConnectingProvider] = useState<'gmail' | 'outlook' | null>(null);
  const checkAuth = useAuthStore((state) => state.checkAuth);

  const handleConnectGmail = async () => {
    setIsConnecting(true);
    setConnectingProvider('gmail');
    try {
      const success = await connectGmail();
      if (success) {
        await checkAuth();
      } else {
        Alert.alert('Cancelled', 'Sign in was cancelled.');
      }
    } catch (error: any) {
      console.error('Gmail connect error:', error);
      Alert.alert('Error', error?.message || 'Failed to sign in with Gmail.');
    } finally {
      setIsConnecting(false);
      setConnectingProvider(null);
    }
  };

  const handleConnectOutlook = async () => {
    setIsConnecting(true);
    setConnectingProvider('outlook');
    try {
      const success = await connectOutlook();
      if (success) {
        await checkAuth();
      } else {
        Alert.alert('Cancelled', 'Sign in was cancelled.');
      }
    } catch (error: any) {
      console.error('Outlook connect error:', error);
      Alert.alert('Error', error?.message || 'Failed to sign in with Outlook.');
    } finally {
      setIsConnecting(false);
      setConnectingProvider(null);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Vera</Text>
          <Text style={styles.subtitle}>Your Email Assistant</Text>
        </View>

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={styles.instructionText}>
            Sign in with your email to get started.
          </Text>
          <Text style={styles.instructionText}>
            Vera will help you read and manage your emails.
          </Text>
        </View>

        {/* Sign In Buttons */}
        <View style={styles.buttons}>
          <TouchableOpacity
            style={[styles.button, styles.gmailButton]}
            onPress={handleConnectGmail}
            disabled={isConnecting}
          >
            {isConnecting && connectingProvider === 'gmail' ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="mail" size={28} color="white" />
            )}
            <Text style={styles.buttonText}>Sign in with Gmail</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.outlookButton]}
            onPress={handleConnectOutlook}
            disabled={isConnecting}
          >
            {isConnecting && connectingProvider === 'outlook' ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <Ionicons name="mail" size={28} color="white" />
            )}
            <Text style={styles.buttonText}>Sign in with Outlook</Text>
          </TouchableOpacity>
        </View>

        {/* Permission Hint */}
        <Text style={styles.hint}>
          When signing in, please allow all permissions so Vera can read and send emails for you.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF5EB',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 56,
    fontWeight: '700',
    color: '#333',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 20,
    color: '#666',
    marginTop: 8,
  },
  instructions: {
    alignItems: 'center',
    marginBottom: 48,
  },
  instructionText: {
    fontSize: 18,
    color: '#555',
    textAlign: 'center',
    lineHeight: 28,
  },
  buttons: {
    gap: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderRadius: 16,
    gap: 16,
  },
  gmailButton: {
    backgroundColor: '#EA4335',
  },
  outlookButton: {
    backgroundColor: '#0078D4',
  },
  buttonText: {
    color: 'white',
    fontSize: 22,
    fontWeight: '600',
  },
  hint: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    marginTop: 32,
    lineHeight: 22,
  },
});
