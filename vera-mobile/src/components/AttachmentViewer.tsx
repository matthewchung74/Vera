import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ActivityIndicator,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AttachmentInfo } from './AttachmentIndicator';

interface AttachmentViewerProps {
  attachment: AttachmentInfo | null;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function AttachmentViewer({ attachment, onClose }: AttachmentViewerProps) {
  const insets = useSafeAreaInsets();
  const [imageError, setImageError] = useState(false);

  if (!attachment) return null;

  const isImage = attachment.mimeType.startsWith('image/');
  const isPDF = attachment.mimeType === 'application/pdf' || attachment.name.toLowerCase().endsWith('.pdf');
  const hasData = attachment.dataAvailable && attachment.data;

  const renderContent = () => {
    // File too large to preview
    if (!attachment.dataAvailable) {
      return (
        <View style={styles.centerContent}>
          <Ionicons name="cloud-offline-outline" size={64} color="rgba(255,255,255,0.5)" />
          <Text style={styles.errorTitle}>File too large to preview</Text>
          <Text style={styles.errorSize}>{formatSize(attachment.size)}</Text>
          <Text style={styles.errorHint}>
            Ask Vera to forward this email{'\n'}if you need to view the attachment
          </Text>
        </View>
      );
    }

    // Image preview
    if (isImage && hasData) {
      const uri = `data:${attachment.mimeType};base64,${attachment.data}`;

      if (imageError) {
        return (
          <View style={styles.centerContent}>
            <Ionicons name="image-outline" size={64} color="rgba(255,255,255,0.5)" />
            <Text style={styles.errorTitle}>Could not load image</Text>
          </View>
        );
      }

      return (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.imageContainer}
          maximumZoomScale={5}
          minimumZoomScale={1}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
        >
          <Image
            source={{ uri }}
            style={styles.image}
            resizeMode="contain"
            onError={() => setImageError(true)}
          />
        </ScrollView>
      );
    }

    // PDF - show info (RN doesn't have native PDF viewer without extra deps)
    if (isPDF) {
      return (
        <View style={styles.centerContent}>
          <Ionicons name="document-text" size={64} color="#E65C5C" />
          <Text style={styles.pdfTitle}>{attachment.name}</Text>
          <Text style={styles.pdfSize}>{formatSize(attachment.size)}</Text>
          {hasData ? (
            <Text style={styles.pdfHint}>PDF preview not available in app</Text>
          ) : (
            <Text style={styles.errorHint}>
              Ask Vera to forward this email{'\n'}to view the PDF
            </Text>
          )}
        </View>
      );
    }

    // Other file types
    return (
      <View style={styles.centerContent}>
        <Ionicons name="document-outline" size={64} color="rgba(255,255,255,0.5)" />
        <Text style={styles.errorTitle}>Cannot preview this file type</Text>
        <Text style={styles.errorSize}>{attachment.mimeType}</Text>
      </View>
    );
  };

  return (
    <Modal
      visible={true}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerInfo}>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {attachment.name}
            </Text>
            <Text style={styles.headerSize}>{formatSize(attachment.size)}</Text>
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            accessibilityLabel="Close"
            accessibilityHint="Double tap to close this viewer"
          >
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {renderContent()}
        </View>
      </View>
    </Modal>
  );
}

const { width, height } = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a1a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.1)',
  },
  headerInfo: {
    flex: 1,
    marginRight: 16,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: 'white',
  },
  headerSize: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 2,
  },
  closeButton: {
    backgroundColor: '#4D80E6',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    width: '100%',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: height - 150,
  },
  image: {
    width: width,
    height: height - 150,
  },
  centerContent: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '500',
    color: 'white',
    marginTop: 20,
    textAlign: 'center',
  },
  errorSize: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 8,
  },
  errorHint: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 20,
  },
  pdfTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    marginTop: 20,
    textAlign: 'center',
  },
  pdfSize: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 8,
  },
  pdfHint: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.4)',
    marginTop: 16,
  },
});
