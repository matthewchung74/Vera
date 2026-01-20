import { useState, useCallback, useRef, useEffect } from 'react';
import { Audio } from 'expo-av';

export function useAudioRecording() {
  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [lastRecordingUri, setLastRecordingUri] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const meteringIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Request permissions on mount
  useEffect(() => {
    const getPermissions = async () => {
      try {
        const { status } = await Audio.requestPermissionsAsync();
        setHasPermission(status === 'granted');
        if (status !== 'granted') {
          setError('Microphone permission not granted');
        }
      } catch (err) {
        console.error('Permission error:', err);
        setError('Failed to request permissions');
      }
    };
    getPermissions();

    return () => {
      if (meteringIntervalRef.current) {
        clearInterval(meteringIntervalRef.current);
      }
    };
  }, []);

  // Configure audio session
  useEffect(() => {
    const configureAudio = async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: true,
          shouldDuckAndroid: true,
        });
        console.log('Audio mode configured');
      } catch (err) {
        console.error('Audio config error:', err);
      }
    };
    configureAudio();
  }, []);

  const startListening = useCallback(async () => {
    if (!hasPermission) {
      setError('No microphone permission');
      return;
    }

    try {
      setError(null);

      // Create new recording
      const { recording } = await Audio.Recording.createAsync(
        {
          ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        },
        (status) => {
          // This callback is called periodically during recording
          if (status.isRecording && status.metering !== undefined) {
            // Convert dB to 0-1 scale (dB typically ranges from -160 to 0)
            const normalized = Math.max(0, Math.min(1, (status.metering + 60) / 60));
            setAudioLevel(normalized);
          }
        },
        100 // Update interval in ms
      );

      recordingRef.current = recording;
      setIsListening(true);
      console.log('Recording started');
    } catch (err) {
      console.error('Start recording error:', err);
      setError(err instanceof Error ? err.message : 'Failed to start recording');
    }
  }, [hasPermission]);

  const stopListening = useCallback(async () => {
    if (!recordingRef.current) return;

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      console.log('Recording stopped, saved to:', uri);

      recordingRef.current = null;
      setIsListening(false);
      setAudioLevel(0);
      setLastRecordingUri(uri || null);

      // Auto-playback to verify recording worked
      if (uri) {
        console.log('Playing back recording...');
        await playRecording(uri);
      }

      return uri;
    } catch (err) {
      console.error('Stop recording error:', err);
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
    }
  }, []);

  const playRecording = useCallback(async (uri?: string) => {
    const uriToPlay = uri || lastRecordingUri;
    if (!uriToPlay) {
      console.log('No recording to play');
      return;
    }

    try {
      // Unload previous sound if exists
      if (soundRef.current) {
        await soundRef.current.unloadAsync();
      }

      // Switch audio mode for playback
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      console.log('Loading sound from:', uriToPlay);
      const { sound } = await Audio.Sound.createAsync(
        { uri: uriToPlay },
        { shouldPlay: true }
      );
      soundRef.current = sound;
      setIsPlaying(true);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setIsPlaying(false);
          console.log('Playback finished');
          // Reset audio mode for recording
          Audio.setAudioModeAsync({
            allowsRecordingIOS: true,
            playsInSilentModeIOS: true,
          });
        }
      });
    } catch (err) {
      console.error('Playback error:', err);
      setIsPlaying(false);
    }
  }, [lastRecordingUri]);

  const toggleListening = useCallback(async () => {
    if (isListening) {
      await stopListening();
    } else {
      await startListening();
    }
  }, [isListening, startListening, stopListening]);

  return {
    isListening,
    audioLevel,
    error,
    hasPermission,
    isPlaying,
    lastRecordingUri,
    startListening,
    stopListening,
    toggleListening,
    playRecording,
  };
}
