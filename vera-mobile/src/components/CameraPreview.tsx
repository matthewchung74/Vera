import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Camera, CameraView } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';

export function CameraPreview() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    const { status } = await Camera.getCameraPermissionsAsync();
    setHasPermission(status === 'granted');
  };

  const requestPermission = async () => {
    const { status } = await Camera.requestCameraPermissionsAsync();
    setHasPermission(status === 'granted');
    if (status === 'granted') {
      setIsActive(true);
    }
  };

  if (hasPermission === null) {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="camera" size={56} color="rgba(51, 51, 64, 0.4)" />
        <Text style={styles.placeholderText}>Loading camera...</Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <TouchableOpacity style={styles.placeholder} onPress={requestPermission}>
        <Ionicons name="camera" size={56} color="rgba(51, 51, 64, 0.4)" />
        <Text style={styles.placeholderText}>Tap to enable camera</Text>
      </TouchableOpacity>
    );
  }

  if (!isActive) {
    return (
      <TouchableOpacity style={styles.placeholder} onPress={() => setIsActive(true)}>
        <Ionicons name="camera" size={56} color="rgba(51, 51, 64, 0.4)" />
        <Text style={styles.placeholderText}>Tap to start camera</Text>
      </TouchableOpacity>
    );
  }

  return (
    <CameraView style={styles.camera} facing="back">
      <TouchableOpacity
        style={styles.closeButton}
        onPress={() => setIsActive(false)}
      >
        <Ionicons name="close" size={24} color="white" />
      </TouchableOpacity>
    </CameraView>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E0DDD5',
  },
  placeholderText: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '500',
    color: 'rgba(51, 51, 64, 0.5)',
  },
  camera: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
