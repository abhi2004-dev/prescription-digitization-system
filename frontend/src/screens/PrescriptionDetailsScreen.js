import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';

export default function PrescriptionDetailsScreen({ route, navigation }) {
  const { data, imageUri } = route.params || {};

  // Extract data from API response
  const rawText = data?.raw_text || 'No text extracted';
  const medicines = data?.medicines || [];
  const warnings = data?.warnings || [];
  const prescriptionId = data?.prescription_id;

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'high': return { bg: '#ffdad6', text: '#93000a', icon: '#ba1a1a' };
      case 'moderate': return { bg: '#fff3e0', text: '#e65100', icon: '#ff9800' };
      case 'low': return { bg: '#e8f5e9', text: '#1b5e20', icon: '#4caf50' };
      default: return { bg: '#ffdad6', text: '#93000a', icon: '#ba1a1a' };
    }
  };

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
           {prescriptionId && (
             <Text style={styles.bannerIdText}>#{prescriptionId}</Text>
           )}
        </View>

        {/* Structured Medicines */}
        <Text style={styles.sectionTitle}>
          Structured Medicines ({medicines.length})
        </Text>
        
        {medicines.length > 0 ? (
          medicines.map((med, index) => (
            <View key={index} style={styles.medicineCard}>
               <View style={styles.medicineHeader}>
                  <View style={styles.iconBox}>
                    <MaterialIcons name="medication" size={20} color={COLORS.primary} />
                  </View>
                  <View style={styles.medicineTitleBox}>
                     <Text style={styles.medicineName}>{med.name}</Text>
                     {med.dosage ? (
                       <Text style={styles.medicineTags}>{med.dosage}</Text>
                     ) : null}
                  </View>
               </View>
               
               <View style={styles.dosageInfo}>
                  <View style={styles.dosageItem}>
                     <Text style={styles.dosageLabel}>DOSAGE</Text>
                     <Text style={styles.dosageValue}>{med.dosage || 'Not specified'}</Text>
                  </View>
                  <View style={styles.dosageItem}>
                     <Text style={styles.dosageLabel}>FREQUENCY</Text>
                     <Text style={styles.dosageValue}>{med.frequency || 'Not specified'}</Text>
                  </View>
               </View>
            </View>
          ))
        ) : (
          <View style={styles.emptyCard}>
            <MaterialIcons name="info-outline" size={24} color={COLORS.outline} />
            <Text style={styles.emptyText}>No medicines could be extracted from the image.</Text>
          </View>
        )}

        {/* Drug Interaction Warnings */}
        <Text style={styles.sectionTitle}>
          Interaction Warnings ({warnings.length})
        </Text>

        {warnings.length > 0 ? (
          warnings.map((warning, index) => {
            const colors = getSeverityColor(warning.severity);
            return (
              <View key={index} style={[styles.warningBox, { backgroundColor: colors.bg }]}>
                <MaterialIcons name="warning" size={24} color={colors.icon} />
                <View style={styles.warningTextContainer}>
                  <View style={styles.warningHeaderRow}>
                    <Text style={[styles.warningTitle, { color: colors.text }]}>
                      {warning.drug_1} + {warning.drug_2}
                    </Text>
                    <View style={[styles.severityBadge, { backgroundColor: colors.icon }]}>
                      <Text style={styles.severityText}>
                        {(warning.severity || 'unknown').toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.warningText, { color: colors.text }]}>
                    {warning.message}
                  </Text>
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.safeBox}>
            <MaterialIcons name="check-circle" size={24} color={COLORS.secondary} />
            <View style={styles.warningTextContainer}>
              <Text style={styles.safeTitle}>No Interactions Detected</Text>
              <Text style={styles.safeText}>
                No dangerous drug interactions found for this combination.
              </Text>
            </View>
          </View>
        )}

        {/* Raw OCR Text */}
        <Text style={styles.sectionTitle}>Raw OCR Output</Text>
        <View style={styles.rawTextCard}>
          <Text style={styles.rawText}>{rawText}</Text>
        </View>

        {/* Prescription Image */}
        {imageUri && (
          <View style={styles.imageSection}>
             <Text style={styles.sectionTitle}>Original Image</Text>
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
    flex: 1,
  },
  bannerIdText: {
    color: COLORS.secondaryFixed,
    fontWeight: 'bold',
    fontSize: 12,
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
    marginBottom: 16,
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
    marginTop: 2,
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
  emptyCard: {
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 16,
    padding: 24,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  emptyText: {
    marginLeft: 12,
    color: COLORS.outline,
    fontSize: 14,
    flex: 1,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
  },
  warningTextContainer: {
    marginLeft: 12,
    flex: 1,
  },
  warningHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  warningTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginLeft: 8,
  },
  severityText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  warningText: {
    fontSize: 12,
    lineHeight: 18,
  },
  safeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e6f7f1',
    padding: 16,
    borderRadius: 16,
    marginBottom: 24,
  },
  safeTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.secondary,
    marginBottom: 4,
  },
  safeText: {
    fontSize: 12,
    color: '#006b5c',
    lineHeight: 18,
  },
  rawTextCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  rawText: {
    fontSize: 13,
    color: COLORS.onSurfaceVariant,
    lineHeight: 20,
    fontFamily: 'monospace',
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
