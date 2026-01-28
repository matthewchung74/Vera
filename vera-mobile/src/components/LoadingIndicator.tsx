import { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';

interface LoadingIndicatorProps {
  message?: string;
}

export default function LoadingIndicator({ message = 'Loading' }: LoadingIndicatorProps) {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const duration = 400;
    const delay = 150;

    // Animate dots in sequence
    Animated.loop(
      Animated.sequence([
        Animated.timing(dot1, {
          toValue: 1,
          duration,
          useNativeDriver: true,
        }),
        Animated.timing(dot1, {
          toValue: 0.3,
          duration,
          useNativeDriver: true,
        }),
      ])
    ).start();

    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot2, {
            toValue: 1,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(dot2, {
            toValue: 0.3,
            duration,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }, delay);

    setTimeout(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(dot3, {
            toValue: 1,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(dot3, {
            toValue: 0.3,
            duration,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }, delay * 2);

    // Subtle haptic pulse every 2 seconds
    const hapticInterval = setInterval(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, 2000);

    // Initial haptic
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    return () => {
      clearInterval(hapticInterval);
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vera</Text>
      <View style={styles.dotsContainer}>
        <Animated.View style={[styles.dot, { opacity: dot1 }]} />
        <Animated.View style={[styles.dot, { opacity: dot2 }]} />
        <Animated.View style={[styles.dot, { opacity: dot3 }]} />
      </View>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF5EB',
  },
  title: {
    fontSize: 48,
    fontWeight: '700',
    color: '#333',
    letterSpacing: 2,
    marginBottom: 24,
  },
  dotsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#333',
  },
  message: {
    fontSize: 16,
    color: '#666',
  },
});
