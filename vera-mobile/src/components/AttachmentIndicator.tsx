import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface AttachmentInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataAvailable: boolean;
  data?: string; // base64 encoded
}

interface AttachmentIndicatorProps {
  attachment: AttachmentInfo;
  onPress: () => void;
}

function getIcon(mimeType: string): { name: keyof typeof Ionicons.glyphMap; color: string } {
  if (mimeType.startsWith('image/')) {
    return { name: 'image', color: '#4DC073' };
  }
  if (mimeType === 'application/pdf' || mimeType.includes('pdf')) {
    return { name: 'document-text', color: '#E65C5C' };
  }
  return { name: 'attach', color: '#4D80E6' };
}

function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function AttachmentIndicator({ attachment, onPress }: AttachmentIndicatorProps) {
  const icon = getIcon(attachment.mimeType);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={`Open ${attachment.name}`}
      accessibilityHint="Double tap to view this attachment"
    >
      <Ionicons name={icon.name} size={18} color={icon.color} />
      <Text style={styles.name} numberOfLines={1} ellipsizeMode="middle">
        {attachment.name}
      </Text>
      <Text style={styles.size}>{formatSize(attachment.size)}</Text>
    </TouchableOpacity>
  );
}

interface AttachmentRowProps {
  attachments: AttachmentInfo[];
  onSelect: (attachment: AttachmentInfo) => void;
}

export function AttachmentRow({ attachments, onSelect }: AttachmentRowProps) {
  if (attachments.length === 0) return null;

  return (
    <View style={styles.row}>
      {attachments.map((attachment) => (
        <AttachmentIndicator
          key={attachment.id}
          attachment={attachment}
          onPress={() => onSelect(attachment)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(51, 51, 64, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    marginTop: 8,
    maxWidth: 240,
  },
  name: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333340',
    marginLeft: 8,
    flex: 1,
  },
  size: {
    fontSize: 12,
    color: '#8A8A8A',
    marginLeft: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
});
