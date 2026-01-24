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
    ? 'mic'
    : 'mic';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={styles.container}
    >
      <View style={[styles.orb, { backgroundColor: currentColor }]}>
        <Ionicons name={iconName as any} size={28} color="white" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 100,
    height: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orb: {
    width: 70,
    height: 70,
    borderRadius: 35,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
});
