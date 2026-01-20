import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  AudioSession,
  LiveKitRoom,
  useLocalParticipant,
  useRoomContext,
  useTracks,
  useIOSAudioManagement,
} from '@livekit/react-native';
import { Track, RoomEvent, ConnectionState } from 'livekit-client';

import { VADOrb } from '../src/components/VADOrb';
import { getGmailToken, getOutlookToken } from '../src/services/authService';

// Server config - use localhost for simulator, your Mac's IP for physical device
const TOKEN_SERVER_URL = 'http://localhost:7890';
const LIVEKIT_URL = 'ws://localhost:7880';

// Simple state machine
type AppState = 'idle' | 'connecting' | 'speaking' | 'listening';

// Component that manages iOS audio - only rendered when room is connected
function IOSAudioManager({ room }: { room: any }) {
  useIOSAudioManagement(room, true); // true = prefer speaker output
  return null;
}

// Inner component that uses LiveKit hooks (must be inside LiveKitRoom)
function RoomContent({
  state,
  setState,
}: {
  state: AppState;
  setState: (s: AppState) => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const metadataSetRef = useRef(false);

  // Get remote audio tracks (agent's voice) - include all audio sources
  const audioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown],
    { onlySubscribed: true }
  );

  // Filter to only remote audio tracks (agent's audio)
  const remoteAudioTracks = audioTracks.filter(
    (track) => track.participant.identity !== localParticipant?.identity
  );

  // Log audio track changes for debugging
  useEffect(() => {
    console.log(`[AUDIO] Total tracks: ${audioTracks.length}, Remote tracks: ${remoteAudioTracks.length}`);
    remoteAudioTracks.forEach((track, i) => {
      console.log(`[AUDIO] Track ${i}: ${track.participant.identity} - ${track.publication?.trackSid}`);
    });
  }, [audioTracks.length, remoteAudioTracks.length]);

  // Update state based on whether agent is speaking
  useEffect(() => {
    if (remoteAudioTracks.length > 0) {
      console.log('[STATE] Agent has audio track -> speaking');
      setState('speaking');
    } else if (room?.state === ConnectionState.Connected) {
      console.log('[STATE] No remote audio -> listening');
      setState('listening');
    }
  }, [remoteAudioTracks.length, room?.state, setState]);

  // Set metadata when connected (pass OAuth tokens for email tools)
  useEffect(() => {
    const setMetadata = async () => {
      // Only set metadata when room is fully connected
      if (room?.state === ConnectionState.Connected &&
          localParticipant &&
          !metadataSetRef.current) {
        try {
          // Get OAuth tokens to pass to agent for email tools
          const gmailToken = await getGmailToken();
          const outlookToken = await getOutlookToken();

          console.log('[METADATA] Setting token metadata...');
          console.log(`[METADATA] Gmail: ${gmailToken ? 'yes' : 'no'}, Outlook: ${outlookToken ? 'yes' : 'no'}`);

          await localParticipant.setMetadata(JSON.stringify({
            gmail_token: gmailToken || '',
            outlook_token: outlookToken || '',
          }));
          metadataSetRef.current = true;
          console.log('[METADATA] Token metadata set successfully');
        } catch (err) {
          console.log('[METADATA] Failed to set metadata:', err);
        }
      }
    };
    setMetadata();
  }, [room?.state, localParticipant]);

  // Enable microphone when connected
  useEffect(() => {
    const enableMic = async () => {
      if (localParticipant && room?.state === ConnectionState.Connected) {
        try {
          await localParticipant.setMicrophoneEnabled(true);
          console.log('Microphone enabled');
        } catch (err) {
          console.log('Failed to enable microphone:', err);
        }
      }
    };
    enableMic();
  }, [localParticipant, room?.state]);

  // Handle room events
  useEffect(() => {
    if (!room) return;

    const handleDisconnected = () => {
      console.log('[ROOM] Disconnected');
      setState('idle');
    };

    const handleParticipantConnected = (participant: any) => {
      console.log(`[ROOM] Participant connected: ${participant.identity}`);
    };

    const handleTrackSubscribed = (track: any, publication: any, participant: any) => {
      console.log(`[ROOM] Track subscribed: ${track.kind} from ${participant.identity}`);
      if (track.kind === 'audio') {
        console.log('[ROOM] Audio track received - should be playing');
      }
    };

    const handleTrackPublished = (publication: any, participant: any) => {
      console.log(`[ROOM] Track published: ${publication.kind} from ${participant.identity}`);
    };

    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackPublished, handleTrackPublished);

    // Log current state
    console.log(`[ROOM] Current participants: ${room.remoteParticipants.size}`);
    room.remoteParticipants.forEach((p: any) => {
      console.log(`[ROOM] Existing participant: ${p.identity}`);
      p.trackPublications.forEach((pub: any) => {
        console.log(`[ROOM] - Track: ${pub.kind} subscribed: ${pub.isSubscribed}`);
      });
    });

    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
    };
  }, [room, setState]);

  // Render iOS audio manager when room is connected
  if (room && room.state === ConnectionState.Connected) {
    return <IOSAudioManager room={room} />;
  }
  return null;
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [state, setState] = useState<AppState>('idle');
  const [audioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  const [captionText, setCaptionText] = useState("Hello, I'm Vera.\nTap the ear to talk to me.");

  // Log state changes
  useEffect(() => {
    console.log(`[STATE] -> ${state}`);
  }, [state]);

  // Update caption based on state
  useEffect(() => {
    if (error) {
      setCaptionText(`Error: ${error}`);
    } else {
      switch (state) {
        case 'connecting':
          setCaptionText("Connecting...");
          break;
        case 'speaking':
          setCaptionText("Vera is speaking...");
          break;
        case 'listening':
          setCaptionText("I'm listening...\nSpeak now.");
          break;
        default:
          setCaptionText("Hello, I'm Vera.\nTap the ear to connect.");
      }
    }
  }, [state, error]);

  const handleConnect = useCallback(async () => {
    if (isConnecting) return;

    // If already connected, disconnect
    if (token) {
      setToken(null);
      setState('idle');
      await AudioSession.stopAudioSession();
      return;
    }

    try {
      setIsConnecting(true);
      setError(null);
      setState('connecting');

      // Configure iOS audio for both playback and recording
      // This is critical for hearing Vera's voice on iOS
      await AudioSession.setAppleAudioConfiguration({
        audioCategory: 'playAndRecord',
        audioCategoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'],
        audioMode: 'voiceChat',
      });
      await AudioSession.startAudioSession();
      console.log('[AUDIO] Audio session started with playAndRecord category');

      // Fetch token from server
      const response = await fetch(
        `${TOKEN_SERVER_URL}/token?room=vera-room&identity=user-${Date.now()}`
      );
      if (!response.ok) throw new Error('Failed to get token');
      const data = await response.json();

      setToken(data.token);
    } catch (err) {
      console.error('Connection error:', err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setState('idle');
      await AudioSession.stopAudioSession();
    } finally {
      setIsConnecting(false);
    }
  }, [token, isConnecting]);

  const handleOrbTap = () => {
    handleConnect();
  };

  const handleDisconnect = useCallback(async () => {
    setToken(null);
    setState('idle');
    await AudioSession.stopAudioSession();
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* LiveKit Room - only render when we have a token */}
      {token && (
        <LiveKitRoom
          serverUrl={LIVEKIT_URL}
          token={token}
          connect={true}
          audio={true}
          video={false}
          onDisconnected={handleDisconnect}
        >
          <RoomContent
            state={state}
            setState={setState}
          />
        </LiveKitRoom>
      )}

      {/* Hamburger Menu */}
      <TouchableOpacity
        style={styles.menuButton}
        onPress={() => router.push('/admin')}
      >
        <Ionicons name="menu" size={28} color="rgba(51, 51, 64, 0.4)" />
      </TouchableOpacity>

      {/* Status indicator */}
      <View style={styles.statusContainer}>
        <View style={[
          styles.statusDot,
          { backgroundColor: state !== 'idle' ? '#4DC073' : '#808080' }
        ]} />
        <Text style={styles.statusText}>
          {state !== 'idle' ? 'Connected' : 'Disconnected'}
        </Text>
      </View>

      {/* Caption Area */}
      <ScrollView
        style={styles.captionArea}
        contentContainerStyle={styles.captionContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.captionText}>{captionText}</Text>
      </ScrollView>

      {/* VAD Orb */}
      <View style={[styles.orbContainer, { bottom: insets.bottom + 50 }]}>
        <VADOrb
          isListening={state === 'listening'}
          isVADActive={audioLevel > 0.2}
          isSpeaking={state === 'speaking'}
          isProcessing={state === 'connecting'}
          audioLevel={audioLevel}
          onPress={handleOrbTap}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF5EB',
  },
  menuButton: {
    position: 'absolute',
    top: 60,
    left: 16,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  statusContainer: {
    position: 'absolute',
    top: 68,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 12,
    color: 'rgba(51, 51, 64, 0.6)',
  },
  captionArea: {
    marginTop: 100,
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  captionContent: {
    paddingBottom: 160,
  },
  captionText: {
    fontSize: 48,
    fontWeight: '800',
    color: '#333340',
    lineHeight: 56,
  },
  orbContainer: {
    position: 'absolute',
    right: 24,
  },
});
