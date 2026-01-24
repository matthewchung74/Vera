import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
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

export function MessageList({ messages, attachments, onAttachmentSelect }: MessageListProps) {
  // Sort by timestamp descending (newest first at top)
  const sortedMessages = [...messages].sort((a, b) => b.timestamp - a.timestamp);

  // Find the latest agent message id
  const latestAgentMessage = [...messages]
    .filter((m) => m.role === 'agent')
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  const latestAgentId = latestAgentMessage?.id;

  if (messages.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Hello, I'm Vera.</Text>
        <Text style={styles.emptySubtext}>Tap the mic to talk.</Text>
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
