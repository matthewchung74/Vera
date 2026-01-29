import { Audio } from 'expo-av';
import { useRef, useCallback } from 'react';

// Thinking sound is disabled until asset is added
// Metro resolves require() at bundle time, so we can't use try-catch
// To enable: add thinking.mp3 to assets/sounds/ and uncomment below
// const thinkingSource = require('../../assets/sounds/thinking.mp3');
const thinkingSource = null;

/**
 * Hook to play a subtle looping sound while Vera is thinking/processing.
 * Call startThinking() when agent enters thinking state, stopThinking() when done.
 */
export function useThinkingSound() {
  const soundRef = useRef<Audio.Sound | null>(null);
  const isPlayingRef = useRef(false);

  const startThinking = useCallback(async () => {
    // Don't start if already playing or no sound file
    if (isPlayingRef.current || !thinkingSource) return;

    try {
      const { sound } = await Audio.Sound.createAsync(
        thinkingSource,
        { isLooping: true, volume: 0.3 }
      );
      soundRef.current = sound;
      isPlayingRef.current = true;
      await sound.playAsync();
      console.log('[THINKING] Started thinking sound');
    } catch (error) {
      console.log('[THINKING] Failed to start sound:', error);
    }
  }, []);

  const stopThinking = useCallback(async () => {
    if (!soundRef.current) return;

    try {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      console.log('[THINKING] Stopped thinking sound');
    } catch (error) {
      console.log('[THINKING] Error stopping sound:', error);
    } finally {
      soundRef.current = null;
      isPlayingRef.current = false;
    }
  }, []);

  return { startThinking, stopThinking };
}
