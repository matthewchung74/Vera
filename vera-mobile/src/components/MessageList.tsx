import React, { useEffect, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, Animated, Easing } from 'react-native';
import { AttachmentRow, AttachmentInfo } from './AttachmentIndicator';

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}

interface MessageListProps {
  messages: TranscriptMessage[];
  attachments: AttachmentInfo[];
  onAttachmentSelect: (attachment: AttachmentInfo) => void;
  isThinking?: boolean;
}

function ThinkingIndicator() {
  const dot1Anim = useRef(new Animated.Value(0)).current;
  const dot2Anim = useRef(new Animated.Value(0)).current;
  const dot3Anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const createPulse = (animValue: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(animValue, {
            toValue: 1,
            duration: 400,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
          Animated.timing(animValue, {
            toValue: 0,
            duration: 400,
            easing: Easing.ease,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const anim1 = createPulse(dot1Anim, 0);
    const anim2 = createPulse(dot2Anim, 200);
    const anim3 = createPulse(dot3Anim, 400);

    anim1.start();
    anim2.start();
    anim3.start();

    return () => {
      anim1.stop();
      anim2.stop();
      anim3.stop();
    };
  }, [dot1Anim, dot2Anim, dot3Anim]);

  const getAnimatedStyle = (animValue: Animated.Value) => ({
    opacity: animValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    }),
    transform: [
      {
        scale: animValue.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.3],
        }),
      },
    ],
  });

  return (
    <View style={styles.thinkingRow}>
      <View style={styles.thinkingDots}>
        <Animated.View style={[styles.dot, getAnimatedStyle(dot1Anim)]} />
        <Animated.View style={[styles.dot, getAnimatedStyle(dot2Anim)]} />
        <Animated.View style={[styles.dot, getAnimatedStyle(dot3Anim)]} />
      </View>
    </View>
  );
}

function MessageBubble({
  message,
  isLatestAgent,
  attachments,
  onAttachmentSelect,
}: {
  message: TranscriptMessage;
  isLatestAgent: boolean;
  attachments: AttachmentInfo[];
  onAttachmentSelect: (attachment: AttachmentInfo) => void;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
    // User messages: faded, italic, right-aligned, quoted (ChatGPT style)
    return (
      <View style={styles.userMessageRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>"{message.text}"</Text>
        </View>
      </View>
    );
  }

  // Agent messages: large, prominent, left-aligned (ChatGPT style)
  return (
    <View style={styles.agentMessageRow}>
      <Text style={styles.agentText}>{message.text}</Text>
      {/* Show attachments only with the latest agent message */}
      {isLatestAgent && attachments.length > 0 && (
        <AttachmentRow attachments={attachments} onSelect={onAttachmentSelect} />
      )}
    </View>
  );
}

export function MessageList({ messages, attachments, onAttachmentSelect, isThinking }: MessageListProps) {
  // Sort by timestamp descending (newest first at top)
  const sortedMessages = [...messages].sort((a, b) => b.timestamp - a.timestamp);

  // Find the latest agent message id
  const latestAgentMessage = [...messages]
    .filter((m) => m.role === 'agent')
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const latestAgentId = latestAgentMessage?.id;

  if (messages.length === 0 && !isThinking) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Hello, I'm Vera.</Text>
        <Text style={styles.emptySubtext}>Tap the mic to talk.</Text>
      </View>
    );
  }

  // Show thinking indicator even with no messages
  if (messages.length === 0 && isThinking) {
    return (
      <View style={styles.emptyContainer}>
        <ThinkingIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={sortedMessages}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <MessageBubble
          message={item}
          isLatestAgent={item.id === latestAgentId}
          attachments={attachments}
          onAttachmentSelect={onAttachmentSelect}
        />
      )}
      ListHeaderComponent={isThinking ? <ThinkingIndicator /> : null}
      removeClippedSubviews={false}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  // User message styles - faded, italic, quoted, right-aligned
  userMessageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 20,
  },
  userBubble: {
    maxWidth: '80%',
    backgroundColor: 'rgba(51, 51, 64, 0.06)',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
  },
  userText: {
    fontSize: 16,
    fontStyle: 'italic',
    lineHeight: 22,
    color: '#8A8A8A',
  },
  // Agent message styles - large, prominent, left-aligned
  agentMessageRow: {
    marginBottom: 24,
    paddingRight: 40, // Keep some margin from right edge
  },
  agentText: {
    fontSize: 20,
    fontWeight: '400',
    lineHeight: 28,
    color: '#333340',
  },
  // Thinking indicator
  thinkingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    paddingRight: 40,
  },
  thinkingDots: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#333340',
    marginHorizontal: 3,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  emptyText: {
    fontSize: 48,
    fontWeight: '800',
    color: '#333340',
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 24,
    fontWeight: '600',
    color: '#8A8A8A',
    textAlign: 'center',
    marginTop: 16,
  },
});
