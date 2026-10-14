import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { API_BASE_URL } from '../constants/config';
import { MaterialIcons } from '@expo/vector-icons';
import { exportPrescriptionPDF } from '../services/pdfExportService';
import { speakFullPrescription, stopSpeech } from '../services/ttsService';

function formatDate(dateStr) {
  if (!dateStr) return 'Recent';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Recent';
    const month = d.toLocaleString('en-US', { month: 'short' });
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month} ${day}, ${year}`;
  } catch {
    return 'Recent';
  }
}

export default function HistoryScreen({ navigation }) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportingId, setExportingId] = useState(null);
  const [speakingId, setSpeakingId] = useState(null);

  const fetchRecords = useCallback(async (isPullToRefresh = false) => {
    try {
      if (isPullToRefresh) {
        setRefreshing(true);
      }
      const response = await fetch(`${API_BASE_URL}/prescriptions`);
      if (response.ok) {
        const data = await response.json();
        setRecords(Array.isArray(data) ? data : []);
      } else {
        console.warn(`Prescription records fetch returned status: ${response.status}`);
      }
    } catch (err) {
      console.error("Error fetching prescriptions in records screen:", err);
    } finally {
      setLoading(false);
      if (isPullToRefresh) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchRecords();
    const unsubscribe = navigation.addListener('focus', () => {
      fetchRecords();
    });
    return () => {
      unsubscribe();
      stopSpeech();
    };
  }, [navigation, fetchRecords]);

  const handleExportPDF = async (record, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    const payload = record.extracted_data || record;
    try {
      setExportingId(record.id);
      await exportPrescriptionPDF(payload);
    } catch (err) {
      console.error("Error exporting PDF in history:", err);
      Alert.alert("Export Error", err.message || "Failed to generate medical PDF report.");
    } finally {
      setExportingId(null);
    }
  };

  const handleToggleSpeak = async (record, e) => {
    if (e && e.stopPropagation) e.stopPropagation();
    if (speakingId === record.id) {
      await stopSpeech();
      setSpeakingId(null);
    } else {
      setSpeakingId(record.id);
      const payload = record.extracted_data || record;
      await speakFullPrescription(payload, {
        onDone: () => setSpeakingId(null),
        onStopped: () => setSpeakingId(null),
        onError: () => setSpeakingId(null),
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Medical History</Text>
        <Text style={styles.subtitle}>Access your digitized prescriptions, export PDF reports, and listen to dosage instructions.</Text>
      </View>

      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={() => fetchRecords(true)}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        {loading && records.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Loading prescription records...</Text>
          </View>
        ) : records.length === 0 ? (
          /* Empty State */
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons name="folder-open" size={48} color={COLORS.outline} />
            </View>
            <Text style={styles.emptyTitle}>No prescriptions scanned yet</Text>
            <Text style={styles.emptySubtitle}>
              When you scan or upload prescriptions, your digital medical records and clinical summaries will appear here.
            </Text>
            <TouchableOpacity 
              style={styles.scanNowButton}
              onPress={() => navigation.navigate('Scan')}
              activeOpacity={0.85}
            >
              <MaterialIcons name="add-a-photo" size={18} color="#fff" />
              <Text style={styles.scanNowButtonText}>Scan Prescription</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Live Records List */
          records.map((record, index) => {
            const meds = record.medicines || record.extracted_data?.medicines || [];
            const medNames = meds.map(m => {
              const name = m.drug_name || m.name || m.drug;
              return name ? `${name}${m.strength ? ' ' + m.strength : ''}` : null;
            }).filter(Boolean);

            const medicineSummary = medNames.length > 0 
              ? medNames.join(' • ') 
              : (record.extracted_data?.raw_text ? record.extracted_data.raw_text.substring(0, 60) : 'Extracted medication items');
            
            const firstMed = meds[0] || {};
            const dosageSummary = firstMed.instructions || firstMed.schedule_text || firstMed.frequency || 'As directed by physician';
            
            const isVerified = record.extracted_data?.verification?.license_status === 'Valid' || record.extracted_data?.doctor_license_validated;
            const patientName = record.patient_name || record.extracted_data?.patient_name;
            const doctorName = record.doctor_name || record.extracted_data?.doctor_name;
            const cardTitle = patientName 
              ? `Prescription • ${patientName}` 
              : (doctorName ? `Dr. ${doctorName}` : `Prescription #${record.id}`);
            const dateStr = formatDate(record.date_scanned || record.created_at);
            const isSpeakingThis = speakingId === record.id;
            const isExportingThis = exportingId === record.id;

            return (
              <TouchableOpacity 
                key={record.id || index} 
                style={[styles.card, isSpeakingThis && styles.cardActiveSpeaking]}
                onPress={() => navigation.navigate('PrescriptionDetails', { data: record.extracted_data || record, id: record.id })}
                activeOpacity={0.85}
              >
                <View style={styles.cardHeader}>
                   <View style={{ flex: 1, marginRight: 8 }}>
                     <Text style={styles.dateText}>{dateStr}</Text>
                     <Text style={styles.cardTitle} numberOfLines={1}>{cardTitle}</Text>
                   </View>
                   <View style={[styles.verifiedBadge, isVerified && styles.verifiedBadgeActive]}>
                     <MaterialIcons 
                       name={isVerified ? "verified" : "check-circle"} 
                       size={14} 
                       color={isVerified ? COLORS.secondary : COLORS.outline} 
                     />
                     <Text style={[styles.verifiedText, isVerified && styles.verifiedTextActive]}>
                       {isVerified ? "Doctor Verified" : "AI Digitized"}
                     </Text>
                   </View>
                </View>

                <View style={styles.detailsBox}>
                   <View style={styles.detailRow}>
                     <Text style={styles.detailLabel}>MEDICATIONS ({meds.length})</Text>
                     <Text style={styles.detailValue} numberOfLines={2}>{medicineSummary}</Text>
                   </View>
                   <View style={styles.detailRow}>
                     <Text style={styles.detailLabel}>DOSAGE / SCHEDULE</Text>
                     <Text style={styles.detailValue} numberOfLines={1}>{dosageSummary}</Text>
                   </View>
                   {doctorName ? (
                     <View style={[styles.detailRow, { marginBottom: 0 }]}>
                       <Text style={styles.detailLabel}>PHYSICIAN</Text>
                       <Text style={styles.detailValue} numberOfLines={1}>Dr. {doctorName}</Text>
                     </View>
                   ) : null}
                </View>
                
                {/* Actions Footer Bar */}
                <View style={styles.cardActionsRow}>
                  {/* Quick TTS Audio Button */}
                  <TouchableOpacity
                    style={[styles.quickActionButton, isSpeakingThis && styles.quickActionButtonActive]}
                    onPress={(e) => handleToggleSpeak(record, e)}
                    activeOpacity={0.8}
                  >
                    <MaterialIcons 
                      name={isSpeakingThis ? "stop" : "volume-up"} 
                      size={16} 
                      color={isSpeakingThis ? "#ffffff" : COLORS.primary} 
                    />
                    <Text style={[styles.quickActionText, isSpeakingThis && styles.quickActionTextActive]}>
                      {isSpeakingThis ? "Stop Audio" : "Read Aloud"}
                    </Text>
                  </TouchableOpacity>

                  {/* Quick Export PDF Button */}
                  <TouchableOpacity
                    style={styles.quickActionButton}
                    onPress={(e) => handleExportPDF(record, e)}
                    disabled={isExportingThis}
                    activeOpacity={0.8}
                  >
                    {isExportingThis ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <>
                        <MaterialIcons name="picture-as-pdf" size={16} color={COLORS.primary} />
                        <Text style={styles.quickActionText}>Export PDF</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* View Details Button */}
                  <View style={styles.viewButton}>
                    <Text style={styles.viewButtonText}>Details</Text>
                    <MaterialIcons name="chevron-right" size={16} color={COLORS.primary} />
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
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
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.onSurfaceVariant,
  },
  emptyContainer: {
    padding: 32,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.surfaceLow,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  scanNowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  scanNowButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 8,
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
  cardActiveSpeaking: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: '#f0fdfa',
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
    textTransform: 'uppercase',
  },
  cardTitle: {
    fontSize: 17,
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
  verifiedBadgeActive: {
    backgroundColor: 'rgba(0,107,92,0.08)',
  },
  verifiedText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.onSurfaceVariant,
    marginLeft: 4,
  },
  verifiedTextActive: {
    color: COLORS.secondary,
  },
  detailsBox: {
    backgroundColor: COLORS.surfaceLow,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'column',
    marginBottom: 10,
  },
  detailLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.outline,
    letterSpacing: 1,
    marginBottom: 3,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.onSurface,
    lineHeight: 18,
  },
  cardActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quickActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,103,126,0.08)',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  quickActionButtonActive: {
    backgroundColor: COLORS.primary,
  },
  quickActionText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  quickActionTextActive: {
    color: '#ffffff',
  },
  viewButton: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: COLORS.surfaceHigh,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewButtonText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginRight: 4,
  }
});
