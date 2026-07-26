import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

// ─── CHANGE THIS to your PC's Wi-Fi IP address ─────────────────────
// Run 'ipconfig' in PowerShell and use your Wi-Fi adapter's IPv4 address.
// On Android emulator use: '10.0.2.2'
// On physical device use your PC's LAN IP like: '192.168.1.X'
const API_BASE_URL = 'http://10.119.80.67:8000';

export default function UploadScreen({ navigation }) {
  const [image, setImage] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');

  const pickImage = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Sorry, we need camera permissions to make this work!');
      return;
    }

    let result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled) {
      setImage(result.assets[0].uri);
    }
  };

  const handleProcess = async () => {
    if (!image) return;

    setIsProcessing(true);
    setStatusText('Uploading image...');

    try {
      // Build FormData with the image
      const formData = new FormData();

      // Extract filename and determine MIME type
      const filename = image.split('/').pop() || 'prescription.jpg';
      const ext = filename.split('.').pop().toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';

      formData.append('file', {
        uri: image,
        name: filename,
        type: mimeType,
      });

      setStatusText('Running AI analysis... (this may take 1-2 minutes on first run)');

      // Send to backend — DO NOT set Content-Type header manually with FormData
      const response = await fetch(`${API_BASE_URL}/api/upload`, {
        method: 'POST',
        body: formData,
        // Let fetch auto-set Content-Type with correct multipart boundary
      });

      const data = await response.json();

      if (data.success) {
        setStatusText('Analysis complete!');
        // Navigate to details with the real API response
        navigation.navigate('PrescriptionDetails', {
          data: data,
          imageUri: image,
        });
        setImage(null);
      } else {
        Alert.alert(
          'Analysis Failed',
          data.error || 'Could not process the prescription. Please try a clearer image.',
          [{ text: 'OK' }]
        );
      }
    } catch (error) {
      console.error('Upload error:', error);
      Alert.alert(
        'Connection Error',
        `Could not connect to the server at ${API_BASE_URL}.\n\nMake sure:\n1. Backend is running (uvicorn main:app)\n2. Phone and PC are on the same Wi-Fi\n3. IP address is correct in UploadScreen.js`,
        [{ text: 'OK' }]
      );
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Scan Document</Text>
        <Text style={styles.subtitle}>Upload or capture a handwritten prescription for AI analysis.</Text>
      </View>

      <View style={styles.previewContainer}>
        {image ? (
          <Image source={{ uri: image }} style={styles.previewImage} />
        ) : (
          <View style={styles.placeholderContainer}>
             <MaterialIcons name="document-scanner" size={80} color={COLORS.outlineVariant} />
             <Text style={styles.placeholderText}>No prescription selected</Text>
          </View>
        )}

        {/* Processing overlay */}
        {isProcessing && (
          <View style={styles.processingOverlay}>
            <ActivityIndicator size="large" color={COLORS.primaryContainer} />
            <Text style={styles.processingText}>{statusText}</Text>
          </View>
        )}
      </View>

      {!image ? (
         <View style={styles.actionButtons}>
            <TouchableOpacity style={styles.buttonOutline} onPress={pickImage}>
              <MaterialIcons name="photo-library" size={24} color={COLORS.primary} />
              <Text style={styles.buttonOutlineText}>Gallery</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.buttonPrimary} onPress={takePhoto}>
              <MaterialIcons name="camera-alt" size={24} color={COLORS.onPrimary} />
              <Text style={styles.buttonPrimaryText}>Camera</Text>
            </TouchableOpacity>
         </View>
      ) : (
         <View style={styles.actionButtons}>
            <TouchableOpacity
              style={[styles.buttonOutline, isProcessing && styles.buttonDisabled]}
              onPress={() => setImage(null)}
              disabled={isProcessing}
            >
              <MaterialIcons name="close" size={24} color={isProcessing ? COLORS.outlineVariant : COLORS.primary} />
              <Text style={[styles.buttonOutlineText, isProcessing && styles.textDisabled]}>Retake</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={[styles.buttonPrimary, isProcessing && styles.buttonPrimaryDisabled]}
              onPress={handleProcess}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={COLORS.onPrimary} />
              ) : (
                <MaterialIcons name="analytics" size={24} color={COLORS.onPrimary} />
              )}
              <Text style={styles.buttonPrimaryText}>
                {isProcessing ? 'Analyzing...' : 'Analyze AI'}
              </Text>
            </TouchableOpacity>
         </View>
      )}

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 24,
  },
  header: {
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.onSurfaceVariant,
    lineHeight: 20,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: COLORS.surfaceHigh,
    borderStyle: 'dashed',
    marginBottom: 32,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  placeholderContainer: {
    alignItems: 'center',
  },
  placeholderText: {
    marginTop: 16,
    color: COLORS.outline,
    fontSize: 16,
    fontWeight: '500',
  },
  processingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 24,
    padding: 24,
  },
  processingText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  buttonOutline: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.primaryContainer,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonOutlineText: {
    color: COLORS.primary,
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  buttonPrimary: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonPrimaryText: {
    color: COLORS.onPrimary,
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 8,
  },
  buttonDisabled: {
    borderColor: COLORS.outlineVariant,
  },
  textDisabled: {
    color: COLORS.outlineVariant,
  },
  buttonPrimaryDisabled: {
    backgroundColor: COLORS.outline,
  },
});
