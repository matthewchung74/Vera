import { Audio } from 'expo-av';
import { useRef, useCallback } from 'react';

// Try to load the chime sound - may be undefined if file doesn't exist
let chimeSource: any;
try {
  chimeSource = require('../../assets/sounds/connecting-chime.mp3');
} catch {
  console.log('[CHIME] No connecting-chime.mp3 found - chime disabled');
  chimeSource = null;
}

/**
 * Hook to play a looping chime sound during connection.
 * Call startChime() when connecting, stopChime() when connected or on error.
 */
export function useConnectionChime() {
  const soundRef = useRef<Audio.Sound | null>(null);
  const isPlayingRef = useRef(false);

  const startChime = useCallback(async () => {
    // Don't start if already playing or no sound file
    if (isPlayingRef.current || !chimeSource) return;

    try {
      const { sound } = await Audio.Sound.createAsync(
        chimeSource,
        { isLooping: true, volume: 0.5 }
      );
      soundRef.current = sound;
      isPlayingRef.current = true;
      await sound.playAsync();
      console.log('[CHIME] Started connection chime');
    } catch (error) {
      console.log('[CHIME] Failed to start chime:', error);
      // Non-fatal - connection can proceed without sound
    }
  }, []);

  const stopChime = useCallback(async () => {
    if (!soundRef.current) return;

    try {
      await soundRef.current.stopAsync();
      await soundRef.current.unloadAsync();
      console.log('[CHIME] Stopped connection chime');
    } catch (error) {
      console.log('[CHIME] Error stopping chime:', error);
    } finally {
      soundRef.current = null;
      isPlayingRef.current = false;
    }
  }, []);

  return { startChime, stopChime };
}
