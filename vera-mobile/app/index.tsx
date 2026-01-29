import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
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
  useRemoteParticipants,
} from '@livekit/react-native';
import { Track, RoomEvent, ConnectionState } from 'livekit-client';

import { VADOrb } from '../src/components/VADOrb';
import { MessageList, TranscriptMessage } from '../src/components/MessageList';
import { AttachmentInfo } from '../src/components/AttachmentIndicator';
import { AttachmentViewer } from '../src/components/AttachmentViewer';
import { getGmailToken, getOutlookToken, getUserName } from '../src/services/authService';
import { useUserStore } from '../src/store/userStore';
import { useConnectionChime } from '../src/hooks/useConnectionChime';
import { useThinkingSound } from '../src/hooks/useThinkingSound';

// Server config - OVHcloud VPS with Caddy HTTPS
const TOKEN_SERVER_URL = 'https://vps-d0703279.vps.ovh.ca';
const LIVEKIT_URL = 'wss://vps-d0703279.vps.ovh.ca:7443';

// Simple state machine
type AppState = 'idle' | 'connecting' | 'thinking' | 'speaking' | 'listening';

// Component that manages iOS audio - only rendered when room is connected
function IOSAudioManager({ room }: { room: any }) {
  useIOSAudioManagement(room, true); // true = prefer speaker output
  return null;
}

// Inner component that uses LiveKit hooks (must be inside LiveKitRoom)
function RoomContent({
  state,
  setState,
  setMessages,
  setAttachments,
  currentBatchIdRef,
  onAgentFirstSpoke,
}: {
  state: AppState;
  setState: (s: AppState) => void;
  setMessages: React.Dispatch<React.SetStateAction<TranscriptMessage[]>>;
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentInfo[]>>;
  currentBatchIdRef: React.MutableRefObject<string | null>;
  onAgentFirstSpoke: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const metadataSetRef = useRef(false);
  const agentHasSpokenRef = useRef(false);
  const [agentState, setAgentState] = useState<string>('listening');

  // Get remote audio tracks (agent's voice) - include all audio sources
  const audioTracks = useTracks(
    [Track.Source.Microphone, Track.Source.ScreenShareAudio, Track.Source.Unknown],
    { onlySubscribed: true }
  );

  // Filter to only remote audio tracks (agent's audio)
  const remoteAudioTracks = audioTracks.filter(
    (track) => track.participant.identity !== localParticipant?.identity
  );

  // Find the agent participant and track their state attribute
  useEffect(() => {
    const agentParticipant = remoteParticipants.find(p =>
      p.identity.includes('agent') || p.attributes?.['lk.agent.state']
    );

    if (agentParticipant) {
      // LiveKit agents publish their state via participant attributes
      const state = agentParticipant.attributes?.['lk.agent.state'];
      if (state) {
        console.log(`[AGENT] Agent state attribute: ${state}`);
        setAgentState(state);
      }
    } else {
      // Agent disconnected or not present - reset to listening
      console.log('[AGENT] No agent found, resetting state to listening');
      setAgentState('listening');
    }
  }, [remoteParticipants]);

  // Log audio track changes for debugging and stop chime when agent audio arrives
  useEffect(() => {
    console.log(`[AUDIO] Total tracks: ${audioTracks.length}, Remote tracks: ${remoteAudioTracks.length}`);
    remoteAudioTracks.forEach((track, i) => {
      console.log(`[AUDIO] Track ${i}: ${track.participant.identity} - ${track.publication?.trackSid}`);
    });

    // Stop chime as soon as we have agent audio (backup trigger)
    if (remoteAudioTracks.length > 0) {
      console.log('[AUDIO] Agent audio detected, stopping chime');
      onAgentFirstSpoke();
    }
  }, [audioTracks.length, remoteAudioTracks.length, onAgentFirstSpoke]);

  // Update state based on agent's actual state (not just track presence)
  useEffect(() => {
    if (room?.state !== ConnectionState.Connected) {
      return;
    }

    // Use the agent's published state attribute
    // Possible values: 'listening', 'thinking', 'speaking'
    if (agentState === 'speaking') {
      console.log('[STATE] Agent state is speaking');
      setState('speaking');

      // Stop chime every time agent speaks (not just first time) as backup
      onAgentFirstSpoke();
    } else if (agentState === 'thinking') {
      // Agent is thinking (processing, using tools like email search)
      console.log('[STATE] Agent state is thinking');
      setState('thinking');
    } else {
      // Agent is listening
      console.log(`[STATE] Agent state is ${agentState} -> listening`);
      setState('listening');
    }
  }, [agentState, room?.state, setState, onAgentFirstSpoke]);

  // Set metadata when connected (pass OAuth tokens for email tools)
  useEffect(() => {
    const setMetadata = async () => {
      console.log(`[METADATA] Check: room=${room?.state}, participant=${localParticipant?.identity}, alreadySet=${metadataSetRef.current}`);

      // Only set metadata when room is fully connected
      if (room?.state === ConnectionState.Connected &&
          localParticipant &&
          !metadataSetRef.current) {
        try {
          console.log('[METADATA] Room connected, fetching tokens...');

          // Get OAuth tokens to pass to agent for email tools
          const startTime = Date.now();
          const gmailToken = await getGmailToken();
          console.log(`[METADATA] Gmail token fetch took ${Date.now() - startTime}ms, result: ${gmailToken ? 'got token' : 'null'}`);

          const outlookToken = await getOutlookToken();
          console.log(`[METADATA] Outlook token fetch took ${Date.now() - startTime}ms, result: ${outlookToken ? 'got token' : 'null'}`);

          const userName = await getUserName();
          console.log(`[METADATA] User name: ${userName || 'not available'}`);

          console.log(`[METADATA] Setting metadata with Gmail: ${gmailToken ? 'yes' : 'no'}, Outlook: ${outlookToken ? 'yes' : 'no'}, Name: ${userName || 'none'}`);

          await localParticipant.setMetadata(JSON.stringify({
            gmail_token: gmailToken || '',
            outlook_token: outlookToken || '',
            user_name: userName || '',
          }));
          metadataSetRef.current = true;
          console.log(`[METADATA] Token metadata set successfully (total time: ${Date.now() - startTime}ms)`);
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
      // Check if this is the agent and get initial state
      const state = participant.attributes?.['lk.agent.state'];
      if (state) {
        console.log(`[ROOM] Agent initial state: ${state}`);
        setAgentState(state);
      }
    };

    const handleAttributesChanged = (changedAttributes: Record<string, string>, participant: any) => {
      console.log(`[ROOM] Attributes changed for ${participant.identity}:`, changedAttributes);
      // Check for agent state change
      const state = changedAttributes['lk.agent.state'];
      if (state) {
        console.log(`[AGENT] State changed to: ${state}`);
        setAgentState(state);
      }
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

    const handleDataReceived = (
      payload: Uint8Array,
      participant: any,
      kind: any,
      topic?: string
    ) => {
      try {
        const text = new TextDecoder().decode(payload);
        const data = JSON.parse(text);

        // Note: Transcripts now handled by TranscriptionReceived event, not data channel

        // Handle attachment messages
        if (topic === 'attachment') {
          if (!data.id || data.type !== 'attachment') {
            console.log('[DATA] Malformed attachment message, ignoring');
            return;
          }

          // Extract batch ID from attachment ID (format: "gmail_<msgid>_<filename>")
          const idParts = data.id.split('_');
          const batchId = idParts.length >= 2 ? `${idParts[0]}_${idParts[1]}` : data.id;

          // If new batch, clear old attachments
          if (currentBatchIdRef.current !== batchId) {
            console.log(`[ATTACHMENT] New batch: ${batchId}, clearing old attachments`);
            setAttachments([]);
            currentBatchIdRef.current = batchId;
          }

          const attachment: AttachmentInfo = {
            id: data.id,
            name: data.name || 'unknown',
            mimeType: data.mimeType || 'application/octet-stream',
            size: data.size || 0,
            dataAvailable: data.dataAvailable ?? false,
            data: data.data,
          };

          console.log(`[ATTACHMENT] Received: ${attachment.name} (${attachment.size} bytes, dataAvailable=${attachment.dataAvailable})`);

          // Add attachment, deduping by id
          setAttachments((prev) => {
            if (prev.some((a) => a.id === attachment.id)) {
              return prev;
            }
            // Limit to 10 attachments
            const newList = [...prev, attachment];
            return newList.slice(-10);
          });
        }
      } catch (e) {
        console.log('[DATA] Failed to parse data:', e);
      }
    };

    // Handle transcription received (built-in LiveKit transcription)
    const handleTranscriptionReceived = (
      segments: any[],
      participant: any,
      publication: any
    ) => {
      // Combine all segment texts
      const fullText = segments.map((s: any) => s.text).join(' ');
      if (!fullText.trim()) return;

      // Check if this is a final transcription
      const isFinal = segments[segments.length - 1]?.final ?? true;

      // Determine if this is from the agent or user based on participant
      const isAgent = participant?.identity?.includes('agent') ||
                      !participant?.identity?.startsWith('user-');
      const role: 'user' | 'agent' = isAgent ? 'agent' : 'user';

      // Use segment ID or generate one
      const segmentId = segments[0]?.id || `trans-${Date.now()}`;

      console.log(`[TRANSCRIPTION] ${role} (final=${isFinal}): ${fullText.substring(0, 50)}...`);

      // For user messages: skip interim to avoid clutter, only show final
      // For agent messages: show all (including interim) for real-time streaming effect
      if (!isFinal && role === 'user') {
        return;
      }

      const now = Date.now();

      setMessages((prev) => {
        // For agent interim messages, update existing or add new
        if (!isFinal && role === 'agent') {
          const existingIdx = prev.findIndex((m) => m.id === segmentId);
          if (existingIdx >= 0) {
            const updated = [...prev];
            updated[existingIdx] = { ...updated[existingIdx], text: fullText };
            return updated;
          }
          return [...prev, { id: segmentId, role, text: fullText, timestamp: now }];
        }

        // For final USER messages: merge with recent message if within 5 seconds
        // This prevents speech pauses from creating multiple bubbles
        if (role === 'user') {
          let recentIdx = -1;
          for (let i = prev.length - 1; i >= 0; i--) {
            if (prev[i].role === 'user' && (now - prev[i].timestamp) < 5000) {
              recentIdx = i;
              break;
            }
          }

          if (recentIdx >= 0) {
            const updated = [...prev];
            const existing = updated[recentIdx];
            // Don't duplicate if text is already contained
            if (!existing.text.includes(fullText) && !fullText.includes(existing.text)) {
              updated[recentIdx] = {
                ...existing,
                text: existing.text + ' ' + fullText,
                timestamp: now,
              };
              return updated;
            }
            // If duplicate, just update timestamp
            updated[recentIdx] = { ...existing, timestamp: now };
            return updated;
          }
        }

        // Check for duplicate by segment ID
        const existingIdx = prev.findIndex((m) => m.id === segmentId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          updated[existingIdx] = { id: segmentId, role, text: fullText, timestamp: now };
          return updated;
        }

        return [...prev, { id: segmentId, role, text: fullText, timestamp: now }];
      });
    };

    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.ParticipantConnected, handleParticipantConnected);
    room.on(RoomEvent.ParticipantAttributesChanged, handleAttributesChanged);
    room.on(RoomEvent.TrackSubscribed, handleTrackSubscribed);
    room.on(RoomEvent.TrackPublished, handleTrackPublished);
    room.on(RoomEvent.DataReceived, handleDataReceived);
    room.on(RoomEvent.TranscriptionReceived, handleTranscriptionReceived);

    // Log current state and check for existing agent
    console.log(`[ROOM] Current participants: ${room.remoteParticipants.size}`);
    room.remoteParticipants.forEach((p: any) => {
      console.log(`[ROOM] Existing participant: ${p.identity}`);
      // Check if existing participant is agent with state
      const state = p.attributes?.['lk.agent.state'];
      if (state) {
        console.log(`[ROOM] Found existing agent with state: ${state}`);
        setAgentState(state);
      }
      p.trackPublications.forEach((pub: any) => {
        console.log(`[ROOM] - Track: ${pub.kind} subscribed: ${pub.isSubscribed}`);
      });
    });

    return () => {
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.ParticipantConnected, handleParticipantConnected);
      room.off(RoomEvent.ParticipantAttributesChanged, handleAttributesChanged);
      room.off(RoomEvent.TrackSubscribed, handleTrackSubscribed);
      room.off(RoomEvent.TrackPublished, handleTrackPublished);
      room.off(RoomEvent.DataReceived, handleDataReceived);
      room.off(RoomEvent.TranscriptionReceived, handleTranscriptionReceived);
    };
  }, [room, setState, setAgentState, setMessages, setAttachments, currentBatchIdRef]);

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
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [selectedAttachment, setSelectedAttachment] = useState<AttachmentInfo | null>(null);
  const currentBatchIdRef = useRef<string | null>(null);

  // Connection chime - plays while connecting, stops when Vera speaks
  const { startChime, stopChime } = useConnectionChime();

  // Thinking sound - plays while Vera is thinking/processing
  const { startThinking: startThinkingSound, stopThinking: stopThinkingSound } = useThinkingSound();

  // Animation values for orb
  const orbScale = useRef(new Animated.Value(1.3)).current; // Start larger when idle
  const orbBottom = useRef(new Animated.Value(30)).current; // Start higher when idle

  // Log state changes
  useEffect(() => {
    console.log(`[STATE] -> ${state}`);
  }, [state]);

  // Play/stop thinking sound based on state
  useEffect(() => {
    if (state === 'thinking') {
      startThinkingSound();
    } else {
      stopThinkingSound();
    }
  }, [state, startThinkingSound, stopThinkingSound]);

  // Animate orb based on state
  useEffect(() => {
    const isActive = state === 'listening' || state === 'speaking' || state === 'thinking';
    Animated.parallel([
      Animated.spring(orbScale, {
        toValue: isActive ? 1.0 : 1.3,
        useNativeDriver: true,
        friction: 8,
      }),
      Animated.spring(orbBottom, {
        toValue: isActive ? 0 : 30,
        useNativeDriver: false, // Can't use native driver for layout props
        friction: 8,
      }),
    ]).start();
  }, [state, orbScale, orbBottom]);

  // Clear attachments when token becomes null (disconnect)
  // Keep messages for visual continuity - user can see conversation history
  useEffect(() => {
    if (!token) {
      // Don't clear messages - preserve them for visual continuity on reconnect
      // setMessages([]);
      setAttachments([]);
      currentBatchIdRef.current = null;
    }
  }, [token]);

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

      // Start connection chime while connecting
      startChime();

      // Ensure userStore is initialized before connecting
      const userStore = useUserStore.getState();
      if (!userStore.isInitialized) {
        await userStore.initialize();
      }
      const userId = useUserStore.getState().userId;
      if (!userId) {
        throw new Error('Failed to initialize user ID');
      }

      // Configure iOS audio for both playback and recording
      // This is critical for hearing Vera's voice on iOS
      await AudioSession.setAppleAudioConfiguration({
        audioCategory: 'playAndRecord',
        audioCategoryOptions: ['defaultToSpeaker', 'allowBluetooth', 'mixWithOthers'],
        audioMode: 'voiceChat',
      });
      await AudioSession.startAudioSession();
      console.log('[AUDIO] Audio session started with playAndRecord category');

      // Fetch token from server with unique room per user
      const roomName = `user-${userId}`;
      const userIdentity = `user-${userId}`;
      const tokenUrl = `${TOKEN_SERVER_URL}/token?room=${roomName}&identity=${userIdentity}`;
      console.log('[FETCH] Attempting to fetch:', tokenUrl);

      // Add timeout for token fetch
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(tokenUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      console.log('[FETCH] Response status:', response.status);
      if (!response.ok) throw new Error('Failed to get token');
      const data = await response.json();
      console.log(`[FETCH] Got token for room: ${roomName}`);

      setToken(data.token);
    } catch (err) {
      console.error('Connection error:', err);
      stopChime(); // Stop chime on error
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Connection timed out');
      } else {
        setError(err instanceof Error ? err.message : 'Connection failed');
      }
      setState('idle');
      await AudioSession.stopAudioSession();
    } finally {
      setIsConnecting(false);
    }
  }, [token, isConnecting, startChime, stopChime]);

  const handleOrbTap = () => {
    handleConnect();
  };

  const handleDisconnect = useCallback(async () => {
    stopChime(); // Stop chime on disconnect
    stopThinkingSound(); // Stop thinking sound on disconnect
    setToken(null);
    setState('idle');
    // Don't clear messages - preserve them for visual continuity on reconnect
    // setMessages([]);
    setAttachments([]);
    currentBatchIdRef.current = null;
    await AudioSession.stopAudioSession();
  }, [stopChime, stopThinkingSound]);

  // Callback for when agent speaks for the first time
  const handleAgentFirstSpoke = useCallback(() => {
    console.log('[CHIME] Agent first spoke, stopping chime');
    stopChime();
  }, [stopChime]);

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
            setMessages={setMessages}
            setAttachments={setAttachments}
            currentBatchIdRef={currentBatchIdRef}
            onAgentFirstSpoke={handleAgentFirstSpoke}
          />
        </LiveKitRoom>
      )}

      {/* Header Bar */}
      <View style={styles.headerBar}>
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
            { backgroundColor: error ? '#E65C5C' : (state !== 'idle' ? '#4DC073' : '#808080') }
          ]} />
          <Text style={styles.statusText}>
            {error ? error :
              state === 'connecting' ? 'Connecting...' :
              state === 'thinking' ? 'Thinking...' :
              state !== 'idle' ? 'Connected' : 'Disconnected'}
          </Text>
        </View>
      </View>

      {/* Message List - stops above orb footer */}
      <View style={[styles.messageArea, { marginBottom: 100 + insets.bottom }]}>
        <MessageList
          messages={messages}
          attachments={attachments}
          onAttachmentSelect={setSelectedAttachment}
          isThinking={state === 'thinking'}
        />
      </View>

      {/* VAD Orb - fixed at bottom with footer background, animates based on state */}
      <Animated.View style={[
        styles.orbContainer,
        {
          paddingBottom: insets.bottom + 12,
          bottom: orbBottom,
        }
      ]}>
        <Animated.View style={{ transform: [{ scale: orbScale }] }}>
          <VADOrb
            isListening={state === 'listening'}
            isVADActive={audioLevel > 0.2}
            isSpeaking={state === 'speaking'}
            isProcessing={state === 'connecting' || state === 'thinking'}
            audioLevel={audioLevel}
            onPress={handleOrbTap}
          />
        </Animated.View>
      </Animated.View>

      {/* Attachment Viewer Modal */}
      {selectedAttachment && (
        <AttachmentViewer
          attachment={selectedAttachment}
          onClose={() => setSelectedAttachment(null)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF5EB',
  },
  headerBar: {
    backgroundColor: '#F5F0E6',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  menuButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
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
  messageArea: {
    flex: 1,
  },
  orbContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    backgroundColor: '#F5F0E6',
    paddingTop: 8,
  },
});
