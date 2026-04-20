import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';

export default function PrescriptionDetailsScreen({ route, navigation }) {
  const { id, imageUri } = route.params || {};

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Analysis Details</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Verification Banner */}
        <View style={styles.banner}>
           <MaterialIcons name="verified" size={20} color={COLORS.secondaryFixed} />
           <Text style={styles.bannerText}>AI Extraction Complete</Text>
        </View>

        {/* Structured Data */}
        <Text style={styles.sectionTitle}>Structured Medicines</Text>
        
        <View style={styles.medicineCard}>
           <View style={styles.medicineHeader}>
              <View style={styles.iconBox}>
                <MaterialIcons name="medication" size={20} color={COLORS.primary} />
              </View>
              <View style={styles.medicineTitleBox}>
                 <Text style={styles.medicineName}>Amoxicillin 500mg</Text>
                 <Text style={styles.medicineTags}>Antibiotic</Text>
              </View>
           </View>
           
           <View style={styles.dosageInfo}>
              <View style={styles.dosageItem}>
                 <Text style={styles.dosageLabel}>DOSAGE</Text>
                 <Text style={styles.dosageValue}>1 Tablet</Text>
              </View>
              <View style={styles.dosageItem}>
                 <Text style={styles.dosageLabel}>FREQUENCY</Text>
                 <Text style={styles.dosageValue}>3x Daily</Text>
              </View>
           </View>
        </View>

        {/* Interaction Warning (Simulated) */}
        <View style={styles.warningBox}>
          <MaterialIcons name="warning" size={24} color="#ba1a1a" />
          <View style={styles.warningTextContainer}>
            <Text style={styles.warningTitle}>Interaction Check Passed</Text>
            <Text style={styles.warningText}>No dangerous drug interactions detected for this combination against past history.</Text>
          </View>
        </View>

        {imageUri && (
          <View style={styles.imageSection}>
             <Text style={styles.sectionTitle}>Raw Prescription image</Text>
             <Image source={{ uri: imageUri }} style={styles.rawImage} />
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceHigh,
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLow,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.secondary,
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
  },
  bannerText: {
    color: COLORS.onPrimary,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  medicineCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  medicineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceLow,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  medicineTitleBox: {
    flex: 1,
  },
  medicineName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  medicineTags: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
  },
  dosageInfo: {
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 12,
    padding: 12,
  },
  dosageItem: {
    flex: 1,
  },
  dosageLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.outline,
    letterSpacing: 1,
    marginBottom: 4,
  },
  dosageValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffdad6', // error-container
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
  },
  warningTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#93000a',
    marginBottom: 4,
  },
  warningText: {
    fontSize: 12,
    color: '#ba1a1a',
    lineHeight: 18,
  },
  imageSection: {
    marginTop: 8,
  },
  rawImage: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    resizeMode: 'cover',
  }
});
