import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';

export default function UploadScreen({ navigation }) {
  const [image, setImage] = useState(null);

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

  const handleProcess = () => {
    if (!image) return;
    // Simulate sending to backend and navigating to details
    setTimeout(() => {
      navigation.navigate('PrescriptionDetails', { imageUri: image });
      setImage(null);
    }, 1500);
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
            <TouchableOpacity style={styles.buttonOutline} onPress={() => setImage(null)}>
              <MaterialIcons name="close" size={24} color={COLORS.primary} />
              <Text style={styles.buttonOutlineText}>Retake</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.buttonPrimary} onPress={handleProcess}>
              <MaterialIcons name="analytics" size={24} color={COLORS.onPrimary} />
              <Text style={styles.buttonPrimaryText}>Analyze AI</Text>
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
  }
});
