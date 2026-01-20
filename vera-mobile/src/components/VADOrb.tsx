import React from 'react';
import { TouchableOpacity, StyleSheet, View, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface VADOrbProps {
  isListening: boolean;
  isVADActive: boolean;
  isSpeaking: boolean;
  isProcessing: boolean;
  audioLevel?: number;
  onPress: () => void;
}

const COLORS = {
  idle: '#808080',
  listening: '#4DC073',
  vadActive: '#33D966',
  speaking: '#4D80E6',
  processing: '#F2B233',
};

export function VADOrb({
  isListening,
  isVADActive,
  isSpeaking,
  isProcessing,
  onPress,
}: VADOrbProps) {
  const currentColor = isSpeaking
    ? COLORS.speaking
    : isProcessing
    ? COLORS.processing
    : isVADActive
    ? COLORS.vadActive
    : isListening
    ? COLORS.listening
    : COLORS.idle;

  const iconName = isSpeaking
    ? 'volume-high'
    : isProcessing
    ? 'ellipsis-horizontal'
    : isVADActive
    ? 'pulse'
    : isListening
    ? 'ear'
    : 'mic';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={styles.container}
    >
      <View style={[styles.orb, { backgroundColor: currentColor }]}>
        <Ionicons name={iconName as any} size={36} color="white" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orb: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
});
