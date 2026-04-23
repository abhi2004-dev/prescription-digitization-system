import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';

export default function HistoryScreen({ navigation }) {
  const records = [
    { id: 1, date: 'Oct 24, 2023', title: 'Post-Op Recovery', medicine: 'Amoxicillin 500mg', dosage: '1 Tab • 3x Daily' },
    { id: 2, date: 'Sep 12, 2023', title: 'Seasonal Allergy', medicine: 'Cetirizine 10mg', dosage: '1 Tab • Nightly' },
    { id: 3, date: 'Aug 05, 2023', title: 'Cardio Maintenance', medicine: 'Atorvastatin 20mg', dosage: '1 Tab • Nightly' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Medical History</Text>
        <Text style={styles.subtitle}>Access your analyzed prescriptions and digital health archive.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {records.map(record => (
          <TouchableOpacity 
             key={record.id} 
             style={styles.card}
             onPress={() => navigation.navigate('PrescriptionDetails', { id: record.id })}
          >
            <View style={styles.cardHeader}>
               <View>
                 <Text style={styles.dateText}>{record.date}</Text>
                 <Text style={styles.cardTitle}>{record.title}</Text>
               </View>
               <View style={styles.verifiedBadge}>
                 <MaterialIcons name="check-circle" size={14} color={COLORS.secondary} />
                 <Text style={styles.verifiedText}>AI Verified</Text>
               </View>
            </View>

            <View style={styles.detailsBox}>
               <View style={styles.detailRow}>
                 <Text style={styles.detailLabel}>MEDICINE</Text>
                 <Text style={styles.detailValue}>{record.medicine}</Text>
               </View>
               <View style={styles.detailRow}>
                 <Text style={styles.detailLabel}>DOSAGE</Text>
                 <Text style={styles.detailValue}>{record.dosage}</Text>
               </View>
            </View>
            
            <View style={styles.viewButton}>
              <Text style={styles.viewButtonText}>View Full Analysis</Text>
            </View>
          </TouchableOpacity>
        ))}
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
    padding: 24,
    paddingBottom: 16,
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
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  dateText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.primary,
    letterSpacing: 1,
    top: -2,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.onSurfaceVariant,
    marginLeft: 4,
  },
  detailsBox: {
    backgroundColor: COLORS.surfaceLow,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.outline,
    letterSpacing: 1,
  },
  detailValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  viewButton: {
    backgroundColor: COLORS.surfaceHigh,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  viewButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 1,
  }
});
