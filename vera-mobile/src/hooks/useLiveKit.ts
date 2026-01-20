import { useState, useCallback, useRef, useEffect } from 'react';
import { AudioSession } from '@livekit/react-native';

// Server config - localhost works for simulator, use your Mac's IP for physical device
const TOKEN_SERVER_URL = 'http://localhost:7890';
const LIVEKIT_URL = 'ws://localhost:7880';

// Lazy-loaded LiveKit types
type LiveKitRoom = any;
type LiveKitTrack = any;

export function useLiveKit() {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [livekit, setLivekit] = useState<any>(null);

  const roomRef = useRef<LiveKitRoom | null>(null);

  // Load LiveKit lazily
  useEffect(() => {
    import('livekit-client').then((module) => {
      setLivekit(module);
    }).catch((err) => {
      console.error('Failed to load LiveKit:', err);
      setError('Failed to load LiveKit');
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (roomRef.current) {
        roomRef.current.disconnect();
      }
    };
  }, []);

  const fetchToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(
        `${TOKEN_SERVER_URL}/token?room=vera-room&identity=user-${Date.now()}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch token');
      }
      const data = await response.json();
      return data.token;
    } catch (err) {
      console.error('Token fetch error:', err);
      setError('Failed to get connection token');
      return null;
    }
  }, []);

  const setupRoomListeners = useCallback((room: LiveKitRoom) => {
    if (!livekit) return;

    const { RoomEvent, ConnectionState, Track } = livekit;

    room.on(RoomEvent.ConnectionStateChanged, (state: any) => {
      console.log('Connection state:', state);
      setIsConnected(state === ConnectionState.Connected);
      setIsConnecting(state === ConnectionState.Connecting);
    });

    room.on(RoomEvent.TrackSubscribed, (
      track: any,
      publication: any,
      participant: any
    ) => {
      console.log('Track subscribed:', track.kind, 'from', participant.identity);
      if (track.kind === Track.Kind.Audio) {
        // Agent is speaking
        setIsSpeaking(true);
        setIsProcessing(false);
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (
      track: any,
      publication: any,
      participant: any
    ) => {
      if (track.kind === Track.Kind.Audio) {
        setIsSpeaking(false);
      }
    });

    room.on(RoomEvent.DataReceived, (payload: Uint8Array, participant?: any) => {
      const message = new TextDecoder().decode(payload);
      console.log('Data received:', message);
    });

    room.on(RoomEvent.Disconnected, () => {
      console.log('Disconnected from room');
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
    });

    // Monitor local audio level
    room.on(RoomEvent.LocalTrackPublished, (publication: any) => {
      if (publication.track?.kind === Track.Kind.Audio) {
        console.log('Local audio track published');
      }
    });
  }, [livekit]);

  const connect = useCallback(async () => {
    if (isConnecting || isConnected || !livekit) {
      if (!livekit) {
        setError('LiveKit not loaded yet');
      }
      return;
    }

    try {
      setError(null);
      setIsConnecting(true);

      // Fetch token from server
      const token = await fetchToken();
      if (!token) {
        setIsConnecting(false);
        return;
      }

      // Create room if needed
      if (!roomRef.current) {
        const { Room } = livekit;
        roomRef.current = new Room({
          adaptiveStream: true,
          dynacast: true,
        });
        setupRoomListeners(roomRef.current);
      }

      console.log('Connecting to LiveKit:', LIVEKIT_URL);
      await roomRef.current.connect(LIVEKIT_URL, token, {
        autoSubscribe: true,
      });

      // Enable microphone
      await roomRef.current.localParticipant?.setMicrophoneEnabled(true);

      setIsConnected(true);
      setIsListening(true);
      setIsConnecting(false);
      console.log('Connected to LiveKit room');
    } catch (err) {
      console.error('LiveKit connection error:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected, livekit, fetchToken, setupRoomListeners]);

  const disconnect = useCallback(async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      setIsConnected(false);
      setIsListening(false);
      setIsSpeaking(false);
      setIsProcessing(false);
    }
  }, []);

  const toggleConnection = useCallback(async () => {
    if (isConnected) {
      await disconnect();
    } else {
      await connect();
    }
  }, [isConnected, connect, disconnect]);

  const toggleMicrophone = useCallback(async () => {
    if (roomRef.current?.localParticipant) {
      const enabled = roomRef.current.localParticipant.isMicrophoneEnabled;
      await roomRef.current.localParticipant.setMicrophoneEnabled(!enabled);
      setIsListening(!enabled);
    }
  }, []);

  return {
    isConnected,
    isConnecting,
    isListening,
    isSpeaking,
    isProcessing,
    audioLevel,
    error,
    connect,
    disconnect,
    toggleConnection,
    toggleMicrophone,
  };
}
