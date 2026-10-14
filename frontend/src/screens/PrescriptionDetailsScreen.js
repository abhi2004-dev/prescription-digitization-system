import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Alert, Platform, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { API_BASE_URL } from '../constants/config';
import { useAuth } from '../context/AuthContext';
import { MaterialIcons } from '@expo/vector-icons';
import { speakMedication, speakFullPrescription, stopSpeech, buildMedicationSpeechText, TTS_LANGUAGES } from '../services/ttsService';
import { scheduleMedicationAlarms } from '../services/notificationService';
import { exportPrescriptionPDF } from '../services/pdfExportService';
import { addMedicationToProfile as serviceAddMedication } from '../services/profileService';
import DateTimePicker from '@react-native-community/datetimepicker';
import { buildInitialMedicationAlarms, getSavedUserAlarms, saveUserAlarms, parseTimeStringToDate, formatTime12Hour } from '../services/alarmStorage';

export default function PrescriptionDetailsScreen({ route, navigation }) {
  const { user, addMedicationToProfile } = useAuth();
  const { data, imageUri } = route.params || {};

  const [comparingProfile, setComparingProfile] = useState(false);
  const [manualSafetyResults, setManualSafetyResults] = useState(null);

  // Utility Feature States (TTS, Alarms, PDF Export)
  const [speakingIndex, setSpeakingIndex] = useState(null); // null | 'all' | number
  const [selectedLanguage, setSelectedLanguage] = useState('en'); // 'en' | 'hi' | 'kn'
  const [translatingIndex, setTranslatingIndex] = useState(null); // null | 'all' | number
  const [exportingPdf, setExportingPdf] = useState(false);
  const [schedulingAlarms, setSchedulingAlarms] = useState(false);
  const [alarmsScheduled, setAlarmsScheduled] = useState(false);
  const [alarmModalVisible, setAlarmModalVisible] = useState(false);
  const [alarmConfigs, setAlarmConfigs] = useState([]);
  const [savingAlarms, setSavingAlarms] = useState(false);
  const [activePicker, setActivePicker] = useState(null); // null | { medIdx: number, slotIdx: number, date: Date }

  // Stop any ongoing speech when navigating away
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  // Background Auto-Save: Automatically ensure matched prescription medications are added to Active Medications profile list
  useEffect(() => {
    if (scannedDrugs && scannedDrugs.length > 0) {
      if (typeof addMedicationToProfile === 'function') {
        addMedicationToProfile(scannedDrugs);
      } else {
        serviceAddMedication(scannedDrugs, user);
      }
    }
  }, []);

  // Extract structured data from API response
  const rawText = data?.extracted_raw_text || data?.raw_text || 'No text extracted';
  const medicines = data?.medicines || data?.prescribed_medications || [];
  const validMedicines = (medicines || []).filter(med => med && (med.drug_name || med.name || med.drug));
  const prescriptionId = data?.prescription_id || (data?.license_code ? `LIC-${data.license_code}` : null);
  const patientName = data?.patient_name || data?.patient_details?.name;
  const patientAge = data?.patient_age || data?.patient_details?.age;
  const patientSex = data?.patient_sex || data?.patient_details?.sex;
  const doctorName = data?.doctor_name;
  const hospitalName = data?.hospital_name;
  const licenseCode = data?.license_code || data?.doctor_license_number || data?.doctor_id;

  // Doctor Verification Module attributes
  const verification = data?.verification || {};
  const licenseStatus = verification?.license_status || (data?.doctor_license_validated ? 'Valid' : (licenseCode ? 'Invalid' : 'Not Found'));
  const signaturePresent = verification?.signature_present !== undefined 
    ? Boolean(verification.signature_present) 
    : Boolean(data?.signature_verified || data?.sign_present);

  const isLicenseValid = licenseStatus === 'Valid';
  const isFullyVerified = isLicenseValid && signaturePresent === true;
  const isLicenseInvalid = licenseStatus === 'Suspended' || licenseStatus === 'Invalid' || licenseStatus === 'Not Found';
  const isSignatureMissing = signaturePresent === false;

  const doctorAdvice = data?.doctor_suggestions || data?.doctor_advice || data?.advice || [];
  const diseases = data?.diseases_identified || [];
  
  const isOwner = data?.is_owner === true;
  const interactions = data?.interactions || data?.warnings || [];
  const scannedDrugs = data?.scanned_drugs || validMedicines.map(m => m.drug_name || m.name || m.drug).filter(Boolean);

  const getSeverityStyle = (level) => {
    const l = (level || '').toLowerCase();
    if (l.includes('major') || l.includes('high') || l.includes('severe')) {
      return { bg: '#ffdad6', text: '#93000a', border: '#ffb4ab', icon: '#ba1a1a', badge: '#ba1a1a', label: 'MAJOR RISK' };
    }
    if (l.includes('moderate') || l.includes('medium')) {
      return { bg: '#fef3c7', text: '#92400e', border: '#fde68a', icon: '#d97706', badge: '#d97706', label: 'MODERATE RISK' };
    }
    if (l.includes('minor') || l.includes('low')) {
      return { bg: '#e0f2fe', text: '#0369a1', border: '#bae6fd', icon: '#0284c7', badge: '#0284c7', label: 'MINOR RISK' };
    }
    return { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff', icon: '#7e22ce', badge: '#7e22ce', label: 'CAUTION' };
  };

  const handleCompareWithProfile = async () => {
    if (!scannedDrugs || scannedDrugs.length === 0) {
      Alert.alert("No Drugs Detected", "No medication names were extracted from this prescription to compare.");
      return;
    }

    try {
      setComparingProfile(true);
      const profileMeds = user?.active_medications || [];
      const response = await fetch(`${API_BASE_URL}/safety/check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          scanned_drugs: scannedDrugs,
          profile_drugs: profileMeds
        })
      });

      if (!response.ok) {
        throw new Error(`Safety check failed (${response.status})`);
      }

      const checkData = await response.json();
      setManualSafetyResults(checkData.interactions || []);

      // OCR-to-Safety Handoff: Right after successful interaction check returns, auto-save matched medications
      const isExactMatch = Boolean(scannedDrugs && scannedDrugs.length > 0);
      if (isExactMatch) {
        if (typeof addMedicationToProfile === 'function') {
          await addMedicationToProfile(scannedDrugs);
        } else {
          await serviceAddMedication(scannedDrugs, user);
        }
      }
    } catch (err) {
      console.error("Error checking profile DDI in details screen:", err);
      Alert.alert("Safety Engine Error", err.message || "Could not complete safety analysis.");
    } finally {
      setComparingProfile(false);
    }
  };

  // -------------------------------------------------------------
  // Step 2 Action: Regional Speech Synthesis & Language Selection
  // -------------------------------------------------------------
  const handleSelectLanguage = async (langCode) => {
    if (selectedLanguage === langCode) return;
    if (speakingIndex !== null) {
      await stopSpeech();
      setSpeakingIndex(null);
      setTranslatingIndex(null);
    }
    setSelectedLanguage(langCode);
  };

  const handleToggleSpeakMedication = async (med, index) => {
    if (speakingIndex === index) {
      await stopSpeech();
      setSpeakingIndex(null);
      setTranslatingIndex(null);
    } else {
      if (speakingIndex !== null) {
        await stopSpeech();
      }
      setSpeakingIndex(index);
      setTranslatingIndex(index);
      await speakMedication(med, {
        language: selectedLanguage,
        onStart: () => setTranslatingIndex(null),
        onDone: () => {
          setSpeakingIndex(null);
          setTranslatingIndex(null);
        },
        onStopped: () => {
          setSpeakingIndex(null);
          setTranslatingIndex(null);
        },
        onError: () => {
          setSpeakingIndex(null);
          setTranslatingIndex(null);
        },
      });
    }
  };

  const handleToggleSpeakAll = async () => {
    if (speakingIndex === 'all') {
      await stopSpeech();
      setSpeakingIndex(null);
      setTranslatingIndex(null);
    } else {
      if (speakingIndex !== null) {
        await stopSpeech();
      }
      setSpeakingIndex('all');
      setTranslatingIndex('all');
      await speakFullPrescription(data || {}, {
        language: selectedLanguage,
        onStart: () => setTranslatingIndex(null),
        onDone: () => {
          setSpeakingIndex(null);
          setTranslatingIndex(null);
        },
        onStopped: () => {
          setSpeakingIndex(null);
          setTranslatingIndex(null);
        },
        onError: () => {
          setSpeakingIndex(null);
          setTranslatingIndex(null);
        },
      });
    }
  };

  // -------------------------------------------------------------
  // Step 3 Action: Visual Alarm Management & Persistence (Action 1 & 2)
  // -------------------------------------------------------------
  const loadOrInitAlarms = async () => {
    if (!validMedicines || validMedicines.length === 0) return;
    try {
      const saved = await getSavedUserAlarms();
      const savedMap = new Map();
      saved.forEach((item) => {
        if (item?.medication) {
          savedMap.set(item.medication.trim().toLowerCase(), item);
        }
      });

      const initial = validMedicines.map((med) => {
        const medName = (med.drug_name || med.name || med.drug || '').trim();
        const existing = savedMap.get(medName.toLowerCase());
        if (existing && Array.isArray(existing.alarms) && existing.alarms.length > 0) {
          return {
            medication: medName,
            strength: med.strength || existing.strength || '',
            alarms: existing.alarms,
          };
        }
        return buildInitialMedicationAlarms(med);
      });

      setAlarmConfigs(initial);

      const hasAnySaved = validMedicines.some((med) => {
        const medName = (med.drug_name || med.name || med.drug || '').trim().toLowerCase();
        return savedMap.has(medName);
      });
      if (hasAnySaved) {
        setAlarmsScheduled(true);
      }
    } catch (err) {
      console.warn("Failed to load saved alarms:", err);
      setAlarmConfigs(validMedicines.map(buildInitialMedicationAlarms));
    }
  };

  useEffect(() => {
    loadOrInitAlarms();
  }, [data]);

  const handleScheduleAlarms = async () => {
    if (!validMedicines || validMedicines.length === 0) {
      Alert.alert("No Medications", "No medications detected on this prescription to schedule alarms for.");
      return;
    }
    await loadOrInitAlarms();
    setAlarmModalVisible(true);
  };

  const handleToggleSlot = (medIndex, slotIndex) => {
    setAlarmConfigs((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next[medIndex] && next[medIndex].alarms && next[medIndex].alarms[slotIndex]) {
        next[medIndex].alarms[slotIndex].enabled = !next[medIndex].alarms[slotIndex].enabled;
      }
      return next;
    });
  };

  const handleUpdateTime = (medIndex, slotIndex, newTime) => {
    setAlarmConfigs((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      if (next[medIndex] && next[medIndex].alarms && next[medIndex].alarms[slotIndex]) {
        next[medIndex].alarms[slotIndex].time = newTime;
      }
      return next;
    });
  };

  const openTimePicker = (medIndex, slotIndex, currentTimeStr) => {
    setActivePicker({
      medIdx: medIndex,
      slotIdx: slotIndex,
      date: parseTimeStringToDate(currentTimeStr),
    });
  };

  const handleSaveConfiguredAlarms = async () => {
    try {
      setSavingAlarms(true);
      const res = await saveUserAlarms(alarmConfigs);
      if (res.success) {
        setAlarmsScheduled(true);
        setAlarmModalVisible(false);
        const activeCount = alarmConfigs.reduce(
          (total, m) => total + (m.alarms ? m.alarms.filter((a) => a.enabled).length : 0),
          0
        );
        Alert.alert(
          "Medication Alarms Configured ⏰",
          `Configured ${activeCount} reminder time(s) for ${alarmConfigs.length} medication(s).\n\nYour customized schedule is saved in local storage and active in your Patient Profile.`,
          [{ text: "Great, Thank You!" }]
        );
      } else {
        Alert.alert("Alarms Setup", "Could not save alarm configurations.");
      }
    } catch (err) {
      console.error("Error saving configured alarms:", err);
      Alert.alert("Alarms Error", err.message || "Failed to save medication reminders.");
    } finally {
      setSavingAlarms(false);
    }
  };

  // -------------------------------------------------------------
  // Step 4 Action: PDF Medical Report Export & Native Share Sheet
  // -------------------------------------------------------------
  const handleExportPDF = async () => {
    try {
      setExportingPdf(true);
      await exportPrescriptionPDF(data || {});
    } catch (err) {
      console.error("PDF Export error:", err);
      Alert.alert("Export Error", err.message || "Could not export PDF report.");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <MaterialIcons name="arrow-back" size={24} color={COLORS.onSurface} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Clinical Analysis Details</Text>
        <TouchableOpacity style={styles.headerPdfButton} onPress={handleExportPDF} disabled={exportingPdf}>
          {exportingPdf ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <MaterialIcons name="picture-as-pdf" size={22} color={COLORS.primary} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Verification Banner */}
        <View style={styles.banner}>
          <MaterialIcons name="verified" size={20} color={COLORS.secondaryFixed} />
          <Text style={styles.bannerText}>AI Extraction Complete</Text>
          {prescriptionId && (
            <Text style={styles.bannerIdText}>#{prescriptionId}</Text>
          )}
        </View>

        {/* -------------------------------------------------------- */}
        {/* PATIENT UTILITY ACTION TOOLBAR (TTS, Alarms, PDF Export) */}
        {/* -------------------------------------------------------- */}
        <View style={styles.utilityActionCard}>
          <View style={styles.utilityHeaderRow}>
            <Text style={styles.utilityCardTitle}>PATIENT CARE UTILITIES</Text>
            {selectedLanguage !== 'en' && (
              <View style={styles.utilityActiveLangTag}>
                <MaterialIcons name="record-voice-over" size={12} color={COLORS.primary} />
                <Text style={styles.utilityActiveLangText}>
                  {selectedLanguage === 'hi' ? 'Hindi TTS (hi-IN)' : 'Kannada TTS (kn-IN)'}
                </Text>
              </View>
            )}
          </View>

          {/* Regional Language Toggle / Selector for TTS */}
          <View style={styles.ttsLanguageSelectorCard}>
            <View style={styles.ttsLanguageHeader}>
              <View style={styles.ttsLanguageTitleRow}>
                <MaterialIcons name="translate" size={15} color={COLORS.primary} />
                <Text style={styles.ttsLanguageTitle}>Read-Aloud Language</Text>
              </View>
              {translatingIndex !== null && (
                <View style={styles.ttsTranslatingIndicator}>
                  <ActivityIndicator size="small" color={COLORS.primary} style={{ transform: [{ scale: 0.7 }] }} />
                  <Text style={styles.ttsTranslatingText}>Translating...</Text>
                </View>
              )}
            </View>

            <View style={styles.ttsLanguageToggleRow}>
              {[
                { code: 'en', label: 'English', sub: 'en-IN' },
                { code: 'hi', label: 'हिंदी', sub: 'hi-IN' },
                { code: 'kn', label: 'ಕನ್ನಡ', sub: 'kn-IN' },
              ].map((lang) => {
                const isSelected = selectedLanguage === lang.code;
                return (
                  <TouchableOpacity
                    key={lang.code}
                    style={[
                      styles.ttsLangBtn,
                      isSelected && styles.ttsLangBtnActive,
                    ]}
                    onPress={() => handleSelectLanguage(lang.code)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.ttsLangBtnLabel,
                        isSelected && styles.ttsLangBtnLabelActive,
                      ]}
                    >
                      {lang.label}
                    </Text>
                    <Text
                      style={[
                        styles.ttsLangBtnSub,
                        isSelected && styles.ttsLangBtnSubActive,
                      ]}
                    >
                      {lang.sub}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.utilityButtonsGrid}>
            
            {/* 1. TTS Read Aloud Full Prescription */}
            <TouchableOpacity 
              style={[styles.utilBtn, speakingIndex === 'all' && styles.utilBtnActive]} 
              onPress={handleToggleSpeakAll}
              activeOpacity={0.8}
            >
              <View style={[styles.utilIconCircle, speakingIndex === 'all' && styles.utilIconCircleActive]}>
                {translatingIndex === 'all' ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <MaterialIcons 
                    name={speakingIndex === 'all' ? "stop" : "volume-up"} 
                    size={20} 
                    color={speakingIndex === 'all' ? "#ffffff" : COLORS.primary} 
                  />
                )}
              </View>
              <Text style={[styles.utilBtnText, speakingIndex === 'all' && styles.utilBtnTextActive]}>
                {speakingIndex === 'all' 
                  ? (translatingIndex === 'all' ? "Translating..." : "Stop Reading") 
                  : (selectedLanguage === 'en' ? "Read Aloud" : `Read (${selectedLanguage.toUpperCase()})`)}
              </Text>
            </TouchableOpacity>

            {/* 2. Automated Medication Alarms */}
            <TouchableOpacity 
              style={[styles.utilBtn, alarmsScheduled && styles.utilBtnSuccess]} 
              onPress={handleScheduleAlarms}
              disabled={schedulingAlarms}
              activeOpacity={0.8}
            >
              <View style={[styles.utilIconCircle, alarmsScheduled && styles.utilIconCircleSuccess]}>
                {schedulingAlarms ? (
                  <ActivityIndicator size="small" color={COLORS.primary} />
                ) : (
                  <MaterialIcons 
                    name={alarmsScheduled ? "alarm-on" : "alarm-add"} 
                    size={20} 
                    color={alarmsScheduled ? "#ffffff" : "#d97706"} 
                  />
                )}
              </View>
              <Text style={[styles.utilBtnText, alarmsScheduled && styles.utilBtnTextSuccess]}>
                {alarmsScheduled ? "Alarms Active" : "Manage Alarms"}
              </Text>
            </TouchableOpacity>

            {/* 3. PDF Export Report */}
            <TouchableOpacity 
              style={styles.utilBtn} 
              onPress={handleExportPDF}
              disabled={exportingPdf}
              activeOpacity={0.8}
            >
              <View style={[styles.utilIconCircle, { backgroundColor: '#e0f2fe' }]}>
                {exportingPdf ? (
                  <ActivityIndicator size="small" color="#0369a1" />
                ) : (
                  <MaterialIcons name="share" size={20} color="#0284c7" />
                )}
              </View>
              <Text style={styles.utilBtnText}>
                {exportingPdf ? "Exporting..." : "Export PDF"}
              </Text>
            </TouchableOpacity>

          </View>
        </View>

        {/* Top Prominent Safety Banner */}
        {isOwner ? (
          interactions.length > 0 ? (
            <View style={styles.ownerAlertContainer}>
              <View style={styles.ownerAlertHeader}>
                <MaterialIcons name="warning" size={24} color="#ba1a1a" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.ownerAlertTitle}>
                    Harmful Drug Interactions Alert ({interactions.length})
                  </Text>
                  <Text style={styles.ownerAlertSubtitle}>
                    Matched patient profile: {user?.name || 'Registered Patient'} • Potential clinical interactions found.
                  </Text>
                </View>
              </View>

              <View style={styles.interactionsList}>
                {interactions.map((item, idx) => {
                  const sev = getSeverityStyle(item.level || item.severity);
                  return (
                    <View key={idx} style={[styles.interactionCard, { backgroundColor: sev.bg, borderColor: sev.border }]}>
                      <View style={styles.interactionCardHeader}>
                        <View style={styles.interactionPairRow}>
                          <MaterialIcons name="medication" size={18} color={sev.icon} />
                          <Text style={[styles.interactionDrugs, { color: sev.text }]}>
                            {item.drug_1} ⇄ {item.drug_2}
                          </Text>
                        </View>
                        <View style={[styles.sevBadge, { backgroundColor: sev.badge }]}>
                          <Text style={styles.sevBadgeText}>{sev.label}</Text>
                        </View>
                      </View>
                      <Text style={[styles.interactionDescription, { color: sev.text }]}>
                        {item.description || item.message || item.interaction || 'Potential clinical interaction identified.'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : (
            <View style={styles.safeProfileBanner}>
              <MaterialIcons name="verified" size={24} color={COLORS.secondary} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.safeProfileTitle}>Regimen Verified Safe (Profile Match)</Text>
                <Text style={styles.safeProfileSubtitle}>
                  Prescription matched to {user?.name || 'your profile'}. No harmful drug interactions detected with active medications.
                </Text>
              </View>
            </View>
          )
        ) : (
          <View style={styles.nonOwnerCard}>
            <View style={styles.nonOwnerHeader}>
              <MaterialIcons name="account-box" size={24} color={COLORS.primary} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.nonOwnerTitle}>Different Patient Detected</Text>
                <Text style={styles.nonOwnerSubtitle}>
                  Prescription issued for "{patientName || 'another patient'}". Not linked to your personal profile.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.compareButton}
              onPress={handleCompareWithProfile}
              disabled={comparingProfile}
              activeOpacity={0.85}
            >
              {comparingProfile ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <MaterialIcons name="compare-arrows" size={20} color="#fff" />
                  <Text style={styles.compareButtonText}>Compare with My Profile Medications</Text>
                </>
              )}
            </TouchableOpacity>

            {manualSafetyResults && (
              <View style={styles.manualResultsContainer}>
                {manualSafetyResults.length > 0 ? (
                  <View>
                    <Text style={styles.manualResultsTitle}>
                      Identified Risks ({manualSafetyResults.length}):
                    </Text>
                    {manualSafetyResults.map((item, idx) => {
                      const sev = getSeverityStyle(item.level || item.severity);
                      return (
                        <View key={idx} style={[styles.interactionCard, { backgroundColor: sev.bg, borderColor: sev.border, marginTop: 8 }]}>
                          <View style={styles.interactionCardHeader}>
                            <View style={styles.interactionPairRow}>
                              <MaterialIcons name="medication" size={16} color={sev.icon} />
                              <Text style={[styles.interactionDrugs, { color: sev.text }]}>
                                {item.drug_1} ⇄ {item.drug_2}
                              </Text>
                            </View>
                            <View style={[styles.sevBadge, { backgroundColor: sev.badge }]}>
                              <Text style={styles.sevBadgeText}>{sev.label}</Text>
                            </View>
                          </View>
                          <Text style={[styles.interactionDescription, { color: sev.text }]}>
                            {item.description || item.message || 'Documented pharmacological interaction.'}
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.manualSafeRow}>
                    <MaterialIcons name="check-circle" size={20} color={COLORS.secondary} />
                    <Text style={styles.manualSafeText}>
                      No interactions detected between this prescription and your active medications.
                    </Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Section 1: Clinic & Patient Metadata Card (Top) */}
        <View style={styles.clinicalSummaryCard}>
          <View style={styles.sectionHeaderRow}>
            <MaterialIcons name="local-hospital" size={18} color={COLORS.primary} />
            <Text style={styles.clinicalHeader}>CLINIC & PATIENT INFORMATION</Text>
          </View>
          
          <View style={styles.metaGrid}>
            {hospitalName ? (
              <View style={styles.clinicalRow}>
                <MaterialIcons name="business" size={16} color={COLORS.primary} style={styles.rowIcon} />
                <Text style={styles.clinicalLabel}>Clinic/Hospital:</Text>
                <Text style={styles.clinicalValue}>{hospitalName}</Text>
              </View>
            ) : null}

            {patientName ? (
              <View style={styles.clinicalRow}>
                <MaterialIcons name="person" size={16} color={COLORS.primary} style={styles.rowIcon} />
                <Text style={styles.clinicalLabel}>Patient:</Text>
                <Text style={styles.clinicalValue}>
                  {patientName} {patientAge ? `(${patientAge} yrs)` : ''} {patientSex ? `• ${patientSex}` : ''}
                </Text>
              </View>
            ) : null}

            {diseases && diseases.length > 0 ? (
              <View style={styles.clinicalRow}>
                <MaterialIcons name="healing" size={16} color={COLORS.primary} style={styles.rowIcon} />
                <Text style={styles.clinicalLabel}>Diagnosis / Dx:</Text>
                <Text style={styles.clinicalValue}>{diseases.join(', ')}</Text>
              </View>
            ) : null}

            {!hospitalName && !patientName && (!diseases || diseases.length === 0) && (
              <Text style={styles.emptyNote}>Patient and clinic demographics not specified.</Text>
            )}
          </View>
        </View>

        {/* Section 2: Structured Prescribed Medicines */}
        <View style={styles.sectionHeaderBetween}>
          <Text style={styles.sectionTitle}>
            Prescribed Medications ({validMedicines.length})
          </Text>
          {validMedicines.length > 0 && (
            <TouchableOpacity 
              style={styles.readAllPill} 
              onPress={handleToggleSpeakAll}
              activeOpacity={0.8}
            >
              <MaterialIcons 
                name={speakingIndex === 'all' ? "stop" : "volume-up"} 
                size={14} 
                color={COLORS.primary} 
              />
              <Text style={styles.readAllPillText}>
                {speakingIndex === 'all' 
                  ? (translatingIndex === 'all' ? "Translating..." : "Stop Audio") 
                  : (selectedLanguage === 'en' ? "Play All Audio" : `Play All (${selectedLanguage.toUpperCase()})`)}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        
        {validMedicines.length > 0 ? (
          validMedicines.map((med, index) => {
            const drugName = med.drug_name || med.name || med.drug || 'Medication';
            const dosage = med.strength || med.dosage || 'Not specified';
            const form = med.form || 'Oral';
            const frequency = med.frequency || 'As directed';
            const duration = med.duration || '';
            const timing = med.timing || '';
            const scheduleText = med.schedule_text || med.schedule;
            const scheduleSlots = med.schedule_slots;
            const instructions = med.instructions || med.dosage_formatted || med.details;
            const isSpeakingThis = speakingIndex === index;

            return (
              <View key={index} style={[styles.medicineCard, isSpeakingThis && styles.medicineCardSpeaking]}>
                <View style={styles.medicineHeader}>
                  <View style={styles.iconBox}>
                    <MaterialIcons name="medication" size={22} color={COLORS.primary} />
                  </View>
                  <View style={styles.medicineTitleBox}>
                    <Text style={styles.medicineName}>{drugName}</Text>
                    {instructions ? (
                      <Text style={styles.medicineTags}>{instructions}</Text>
                    ) : null}
                  </View>

                  {/* STEP 2: Dedicated Read Aloud Speaker Button on each medication card */}
                  <TouchableOpacity
                    style={[styles.ttsSpeakerButton, isSpeakingThis && styles.ttsSpeakerButtonActive]}
                    onPress={() => handleToggleSpeakMedication(med, index)}
                    activeOpacity={0.8}
                  >
                    {translatingIndex === index ? (
                      <ActivityIndicator size="small" color={isSpeakingThis ? "#ffffff" : COLORS.primary} style={{ transform: [{ scale: 0.75 }] }} />
                    ) : (
                      <MaterialIcons 
                        name="volume-up" 
                        size={18} 
                        color={isSpeakingThis ? "#ffffff" : COLORS.primary} 
                      />
                    )}
                    <Text style={[styles.ttsSpeakerText, isSpeakingThis && styles.ttsSpeakerTextActive]}>
                      {isSpeakingThis 
                        ? (translatingIndex === index ? "Translating..." : "Speaking...") 
                        : (selectedLanguage === 'en' ? "Read Aloud" : `Read (${selectedLanguage.toUpperCase()})`)}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Dedicated Schedule Badge & Time Slots */}
                {(scheduleText || scheduleSlots) ? (
                  <View style={styles.scheduleBadgeContainer}>
                    {scheduleText ? (
                      <View style={styles.scheduleMainPill}>
                        <MaterialIcons name="schedule" size={14} color="#3730a3" />
                        <Text style={styles.scheduleMainText}>{scheduleText}</Text>
                      </View>
                    ) : null}

                    {scheduleSlots && (scheduleSlots.morning || scheduleSlots.afternoon || scheduleSlots.night) ? (
                      <View style={styles.slotChipsRow}>
                        {scheduleSlots.morning ? (
                          <View style={[styles.timeSlotChip, styles.slotMorning]}>
                            <Text style={styles.slotEmoji}>🌅</Text>
                            <Text style={[styles.timeSlotText, styles.slotMorningText]}>Morning (8:00 AM)</Text>
                          </View>
                        ) : null}
                        {scheduleSlots.afternoon ? (
                          <View style={[styles.timeSlotChip, styles.slotAfternoon]}>
                            <Text style={styles.slotEmoji}>☀️</Text>
                            <Text style={[styles.timeSlotText, styles.slotAfternoonText]}>Afternoon (1:00 PM)</Text>
                          </View>
                        ) : null}
                        {scheduleSlots.night ? (
                          <View style={[styles.timeSlotChip, styles.slotNight]}>
                            <Text style={styles.slotEmoji}>🌙</Text>
                            <Text style={[styles.timeSlotText, styles.slotNightText]}>Night (8:00 PM)</Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ) : null}
                
                {/* Detailed Dosage Matrix */}
                <View style={styles.dosageInfo}>
                  <View style={styles.dosageItem}>
                    <Text style={styles.dosageLabel}>DOSAGE / STRENGTH</Text>
                    <Text style={styles.dosageValue}>{dosage}</Text>
                  </View>
                  <View style={styles.dosageItem}>
                    <Text style={styles.dosageLabel}>FORM</Text>
                    <Text style={styles.dosageValue}>{form}</Text>
                  </View>
                  <View style={styles.dosageItem}>
                    <Text style={styles.dosageLabel}>FREQUENCY</Text>
                    <Text style={styles.dosageValue}>{frequency}</Text>
                  </View>
                </View>

                {(duration || timing) ? (
                  <View style={styles.extraMedsInfoRow}>
                    {duration ? (
                      <View style={[styles.miniChip, { backgroundColor: '#dcfce7' }]}>
                        <Text style={[styles.miniChipText, { color: '#166534' }]}>Duration: {duration}</Text>
                      </View>
                    ) : null}
                    {timing ? (
                      <View style={[styles.miniChip, { backgroundColor: '#f3e8ff' }]}>
                        <Text style={[styles.miniChipText, { color: '#6b21a8' }]}>Timing: {timing}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <View style={styles.emptyCard}>
            <MaterialIcons name="info-outline" size={24} color={COLORS.outline} />
            <Text style={styles.emptyText}>No medicines could be extracted from the Rx zone.</Text>
          </View>
        )}

        {/* Section 3: Dedicated Doctor's Advice & Clinical Instructions */}
        <View style={styles.adviceSectionCard}>
          <View style={styles.sectionHeaderRow}>
            <MaterialIcons name="tips-and-updates" size={18} color="#92400e" />
            <Text style={styles.adviceSectionHeader}>DOCTOR'S ADVICE & INSTRUCTIONS</Text>
          </View>

          {doctorAdvice && doctorAdvice.length > 0 ? (
            <View style={styles.adviceListContainer}>
              {doctorAdvice.map((adv, idx) => (
                <View key={idx} style={styles.adviceBulletRow}>
                  <MaterialIcons name="check-circle" size={16} color="#d97706" style={{ marginTop: 2 }} />
                  <Text style={styles.adviceBulletText}>{adv}</Text>
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.adviceEmptyContainer}>
              <MaterialIcons name="info-outline" size={16} color={COLORS.outline} />
              <Text style={styles.adviceEmptyNote}>No lifestyle or dietary instructions specified.</Text>
            </View>
          )}
        </View>

        {/* Section 4: Drug Interaction Warnings */}
        <Text style={styles.sectionTitle}>
          Interaction Analysis ({interactions.length})
        </Text>

        {interactions.length > 0 ? (
          interactions.map((warning, index) => {
            const sev = getSeverityStyle(warning.level || warning.severity);
            return (
              <View key={index} style={[styles.warningBox, { backgroundColor: sev.bg, borderColor: sev.border }]}>
                <MaterialIcons name="warning" size={24} color={sev.icon} />
                <View style={styles.warningTextContainer}>
                  <View style={styles.warningHeaderRow}>
                    <Text style={[styles.warningTitle, { color: sev.text }]}>
                      {warning.drug_1} ⇄ {warning.drug_2}
                    </Text>
                    <View style={[styles.severityBadge, { backgroundColor: sev.badge }]}>
                      <Text style={styles.severityText}>
                        {sev.label}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.warningText, { color: sev.text }]}>
                    {warning.description || warning.message || warning.interaction || 'Clinical interaction risk detected.'}
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
                No dangerous drug interactions found for this regimen.
              </Text>
            </View>
          </View>
        )}

        {/* Section 5: Physician & Document Authentication Metadata Footer */}
        <View style={styles.physicianMetaCard}>
          <View style={styles.sectionHeaderRow}>
            <MaterialIcons name="verified-user" size={18} color={COLORS.primary} />
            <Text style={styles.clinicalHeader}>PHYSICIAN & AUTHENTICATION</Text>
          </View>

          {/* Verification Badge Section */}
          {isFullyVerified ? (
            <View style={styles.verifiedBadgeCard}>
              <View style={styles.badgeHeaderRow}>
                <View style={styles.badgeIconCircleGreen}>
                  <MaterialIcons name="verified" size={22} color="#059669" />
                </View>
                <View style={styles.badgeTextCol}>
                  <View style={styles.badgeTitleRow}>
                    <Text style={styles.verifiedBadgeTitle}>Verified Prescription</Text>
                    <View style={styles.greenPill}>
                      <MaterialIcons name="shield" size={11} color="#065f46" />
                      <Text style={styles.greenPillText}>AUTHENTIC</Text>
                    </View>
                  </View>
                  <Text style={styles.verifiedBadgeSubtitle}>
                    Medical license is active & valid • Verified physician signature present.
                  </Text>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.verificationAlertsContainer}>
              {/* License Warning Badge */}
              {isLicenseInvalid && (
                <View style={styles.invalidLicenseCard}>
                  <View style={styles.badgeHeaderRow}>
                    <View style={styles.badgeIconCircleRed}>
                      <MaterialIcons name="gpp-bad" size={22} color="#dc2626" />
                    </View>
                    <View style={styles.badgeTextCol}>
                      <View style={styles.badgeTitleRow}>
                        <Text style={styles.invalidLicenseTitle}>Warning: Medical License Invalid</Text>
                        <View style={styles.redPill}>
                          <Text style={styles.redPillText}>
                            {licenseStatus === 'Suspended' ? 'SUSPENDED' : (licenseStatus === 'Invalid' ? 'INVALID' : 'UNREGISTERED')}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.invalidLicenseSubtitle}>
                        {licenseCode
                          ? `Doctor registration #${licenseCode} is marked as ${licenseStatus} in the medical license database.`
                          : 'No valid physician registration number found on this prescription.'}
                      </Text>
                    </View>
                  </View>
                </View>
              )}

              {/* Missing Signature Warning Badge */}
              {isSignatureMissing && (
                <View style={styles.missingSignatureCard}>
                  <View style={styles.badgeHeaderRow}>
                    <View style={styles.badgeIconCircleAmber}>
                      <MaterialIcons name="warning" size={22} color="#d97706" />
                    </View>
                    <View style={styles.badgeTextCol}>
                      <View style={styles.badgeTitleRow}>
                        <Text style={styles.missingSignatureTitle}>Missing Doctor Signature</Text>
                        <View style={styles.amberPill}>
                          <Text style={styles.amberPillText}>UNSIGNED</Text>
                        </View>
                      </View>
                      <Text style={styles.missingSignatureSubtitle}>
                        No physician signature detected in the bottom-right quadrant of this prescription slip.
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          )}

          <View style={styles.metaGrid}>
            {doctorName ? (
              <View style={styles.clinicalRow}>
                <MaterialIcons name="medical-services" size={16} color={COLORS.primary} style={styles.rowIcon} />
                <Text style={styles.clinicalLabel}>Physician:</Text>
                <Text style={styles.clinicalValue}>Dr. {doctorName}</Text>
              </View>
            ) : null}

            <View style={styles.clinicalRow}>
              <MaterialIcons
                name="badge"
                size={16}
                color={isLicenseValid ? "#059669" : "#dc2626"}
                style={styles.rowIcon}
              />
              <Text style={styles.clinicalLabel}>License / Reg:</Text>
              <Text style={[styles.clinicalValue, { color: isLicenseValid ? "#059669" : "#dc2626" }]}>
                {licenseCode ? `${licenseCode} (${licenseStatus})` : 'Not Provided'}
              </Text>
            </View>

            <View style={styles.clinicalRow}>
              <MaterialIcons
                name={signaturePresent ? "verified" : "warning"}
                size={16}
                color={signaturePresent ? "#059669" : "#d97706"}
                style={styles.rowIcon}
              />
              <Text style={styles.clinicalLabel}>Signature:</Text>
              <Text style={[styles.clinicalValue, { color: signaturePresent ? "#059669" : "#d97706" }]}>
                {signaturePresent ? "Doctor Signature Verified" : "Missing Doctor Signature"}
              </Text>
            </View>
          </View>
        </View>

        {/* Action Export Button at the Bottom */}
        <TouchableOpacity
          style={styles.exportReportFullButton}
          onPress={handleExportPDF}
          disabled={exportingPdf}
          activeOpacity={0.85}
        >
          {exportingPdf ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <>
              <MaterialIcons name="picture-as-pdf" size={20} color="#ffffff" />
              <Text style={styles.exportReportFullButtonText}>Export Official Medical PDF Report</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Section 6: Raw OCR Text */}
        <Text style={styles.sectionTitle}>Raw OCR Output</Text>
        <View style={styles.rawTextCard}>
          <Text style={styles.rawText}>{rawText}</Text>
        </View>

        {/* Section 7: Prescription Image */}
        {imageUri && (
          <View style={styles.imageSection}>
            <Text style={styles.sectionTitle}>Original Document Scan</Text>
            <Image source={{ uri: imageUri }} style={styles.rawImage} />
          </View>
        )}

      </ScrollView>

      {/* ------------------------------------------------------------- */}
      {/* Action 1 & 2: MANAGE ALARMS MODAL (Auto-set, Edit & Persist)  */}
      {/* ------------------------------------------------------------- */}
      <Modal
        visible={alarmModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setAlarmModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.modalAlarmIconBadge}>
                  <MaterialIcons name="alarm" size={24} color={COLORS.primary} />
                </View>
                <View>
                  <Text style={styles.modalTitle}>Manage Medication Alarms</Text>
                  <Text style={styles.modalSubtitle}>Auto-set & edit reminder schedules</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.modalCloseButton}
                onPress={() => setAlarmModalVisible(false)}
              >
                <MaterialIcons name="close" size={22} color={COLORS.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            {/* Modal Body */}
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalDescription}>
                Times auto-populated from clinical schedule. Tap any time to adjust.
              </Text>

              {alarmConfigs.length > 0 ? (
                alarmConfigs.map((medConfig, medIdx) => (
                  <View key={`alarm-med-${medIdx}`} style={styles.medAlarmCard}>
                    <View style={styles.medAlarmCardHeader}>
                      <MaterialIcons name="medication" size={18} color={COLORS.primary} />
                      <Text style={styles.medAlarmCardTitle}>
                        {medConfig.medication}
                        {medConfig.strength ? ` (${medConfig.strength})` : ''}
                      </Text>
                    </View>

                    <View style={styles.slotsContainer}>
                      {medConfig.alarms.map((slot, slotIdx) => (
                        <View
                          key={`slot-${slot.slot}`}
                          style={[
                            styles.slotRow,
                            slot.enabled ? styles.slotRowActive : styles.slotRowInactive,
                          ]}
                        >
                          <TouchableOpacity
                            style={styles.slotToggleTouch}
                            onPress={() => handleToggleSlot(medIdx, slotIdx)}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons
                              name={slot.enabled ? "check-box" : "check-box-outline-blank"}
                              size={22}
                              color={slot.enabled ? COLORS.primary : COLORS.outline}
                            />
                            <Text style={styles.slotEmoji}>{slot.emoji}</Text>
                            <View style={styles.slotLabelCol}>
                              <Text style={[styles.slotLabel, slot.enabled && styles.slotLabelActive]}>
                                {slot.label}
                              </Text>
                              <Text style={styles.slotSubtext}>
                                {slot.slot === 'morning' ? 'Default: 8:00 AM' : slot.slot === 'afternoon' ? 'Default: 1:00 PM' : 'Default: 8:00 PM'}
                              </Text>
                            </View>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[
                              styles.timePickerButton,
                              !slot.enabled && styles.timePickerButtonDisabled,
                            ]}
                            onPress={() => openTimePicker(medIdx, slotIdx, slot.time)}
                            disabled={!slot.enabled}
                            activeOpacity={0.7}
                          >
                            <MaterialIcons
                              name="access-time"
                              size={15}
                              color={slot.enabled ? COLORS.primary : COLORS.outline}
                            />
                            <Text
                              style={[
                                styles.timePickerText,
                                !slot.enabled && styles.timePickerTextDisabled,
                              ]}
                            >
                              {slot.time || 'Set Time'}
                            </Text>
                            <MaterialIcons
                              name="arrow-drop-down"
                              size={18}
                              color={slot.enabled ? COLORS.primary : COLORS.outline}
                            />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyModalCard}>
                  <Text style={styles.emptyModalText}>No medications found to configure.</Text>
                </View>
              )}
            </ScrollView>

            {/* Modal Footer Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setAlarmModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveConfiguredAlarms}
                disabled={savingAlarms}
              >
                {savingAlarms ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <MaterialIcons name="save" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.modalSaveBtnText}>Save Configured Alarms</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Native Digital Clock / Time Picker Dialog */}
            {activePicker && (
              <DateTimePicker
                value={activePicker.date}
                mode="time"
                is24Hour={false}
                display={Platform.OS === 'android' ? 'clock' : 'spinner'}
                onChange={(event, selectedDate) => {
                  if (event.type === 'dismissed') {
                    setActivePicker(null);
                    return;
                  }
                  const chosen = selectedDate || activePicker.date;
                  const formatted = formatTime12Hour(chosen);
                  handleUpdateTime(activePicker.medIdx, activePicker.slotIdx, formatted);
                  setActivePicker(null);
                }}
              />
            )}
          </View>
        </View>
      </Modal>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceHigh,
    backgroundColor: COLORS.surface,
  },
  backButton: {
    padding: 8,
    borderRadius: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  headerPdfButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(0,103,126,0.08)',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 16,
    marginBottom: 16,
  },
  bannerText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
    marginLeft: 8,
    flex: 1,
  },
  bannerIdText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: '600',
  },

  // Patient Care Utilities Action Toolbar Styles
  utilityActionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  utilityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  utilityActiveLangTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,103,126,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  utilityActiveLangText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  ttsLanguageSelectorCard: {
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 14,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  ttsLanguageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  ttsLanguageTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ttsLanguageTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurface,
    letterSpacing: 0.3,
  },
  ttsTranslatingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ttsTranslatingText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.primary,
    fontStyle: 'italic',
  },
  ttsLanguageToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  ttsLangBtn: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  ttsLangBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  ttsLangBtnLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  ttsLangBtnLabelActive: {
    color: '#ffffff',
  },
  ttsLangBtnSub: {
    fontSize: 10,
    fontWeight: '500',
    color: COLORS.outline,
    marginTop: 2,
  },
  ttsLangBtnSubActive: {
    color: 'rgba(255,255,255,0.85)',
  },
  utilityCardTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.outline,
    letterSpacing: 1.2,
    marginBottom: 0,
  },
  utilityButtonsGrid: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  utilBtn: {
    flex: 1,
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  utilBtnActive: {
    backgroundColor: '#eff6ff',
    borderColor: COLORS.primary,
  },
  utilBtnSuccess: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  utilIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,103,126,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  utilIconCircleActive: {
    backgroundColor: COLORS.primary,
  },
  utilIconCircleSuccess: {
    backgroundColor: '#059669',
  },
  utilBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurface,
    textAlign: 'center',
  },
  utilBtnTextActive: {
    color: COLORS.primary,
  },
  utilBtnTextSuccess: {
    color: '#065f46',
  },

  ownerAlertContainer: {
    backgroundColor: '#fff5f5',
    borderRadius: 20,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1.5,
    borderColor: '#ffcdd2',
    shadowColor: '#ba1a1a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  ownerAlertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  ownerAlertTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ba1a1a',
    marginBottom: 2,
  },
  ownerAlertSubtitle: {
    fontSize: 12,
    color: '#7f1d1d',
    lineHeight: 16,
  },
  interactionsList: {
    gap: 8,
  },
  interactionCard: {
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
  },
  interactionCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  interactionPairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  interactionDrugs: {
    fontSize: 13,
    fontWeight: '700',
    flex: 1,
  },
  sevBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sevBadgeText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  interactionDescription: {
    fontSize: 12,
    lineHeight: 17,
  },
  safeProfileBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  safeProfileTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#065f46',
    marginBottom: 2,
  },
  safeProfileSubtitle: {
    fontSize: 12,
    color: '#047857',
    lineHeight: 16,
  },
  nonOwnerCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  nonOwnerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  nonOwnerTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 2,
  },
  nonOwnerSubtitle: {
    fontSize: 12,
    color: COLORS.onSurfaceVariant,
    lineHeight: 16,
  },
  compareButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
  },
  compareButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
  },
  manualResultsContainer: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceHigh,
  },
  manualResultsTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 6,
  },
  manualSafeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    padding: 12,
    borderRadius: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  manualSafeText: {
    flex: 1,
    fontSize: 12,
    color: '#065f46',
    fontWeight: '500',
  },
  clinicalSummaryCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  sectionHeaderBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  readAllPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,103,126,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  readAllPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  clinicalHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.primary,
    letterSpacing: 1.2,
  },
  metaGrid: {
    gap: 10,
  },
  clinicalRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowIcon: {
    marginRight: 8,
  },
  clinicalLabel: {
    fontSize: 13,
    color: COLORS.onSurfaceVariant,
    fontWeight: '600',
    width: 110,
  },
  clinicalValue: {
    flex: 1,
    fontSize: 13,
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  emptyNote: {
    fontSize: 13,
    color: COLORS.outline,
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 12,
  },
  medicineCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  medicineCardSpeaking: {
    borderColor: COLORS.primary,
    borderWidth: 2,
    backgroundColor: '#f0fdfa',
  },
  medicineHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(0,103,126,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  medicineTitleBox: {
    flex: 1,
    marginRight: 8,
  },
  medicineName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  medicineTags: {
    fontSize: 12,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: 2,
  },
  // Step 2 TTS Speaker Button
  ttsSpeakerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,103,126,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,103,126,0.15)',
  },
  ttsSpeakerButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  ttsSpeakerText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  ttsSpeakerTextActive: {
    color: '#ffffff',
  },
  scheduleBadgeContainer: {
    backgroundColor: '#eef2ff',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  scheduleMainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  scheduleMainText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#3730a3',
  },
  slotChipsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  timeSlotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  slotMorning: {
    backgroundColor: '#fffbeb',
  },
  slotMorningText: {
    color: '#b45309',
  },
  slotAfternoon: {
    backgroundColor: '#fef3c7',
  },
  slotAfternoonText: {
    color: '#d97706',
  },
  slotNight: {
    backgroundColor: '#e0e7ff',
  },
  slotNightText: {
    color: '#4338ca',
  },
  timeSlotText: {
    fontSize: 11,
    fontWeight: '600',
  },
  slotEmoji: {
    fontSize: 11,
  },
  dosageInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  dosageItem: {
    flex: 1,
  },
  dosageLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: COLORS.outline,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  dosageValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  extraMedsInfoRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  miniChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  miniChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyText: {
    marginTop: 8,
    color: COLORS.outline,
    fontSize: 13,
  },
  adviceSectionCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#fef3c7',
  },
  adviceSectionHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#92400e',
    letterSpacing: 1.2,
  },
  adviceListContainer: {
    gap: 8,
  },
  adviceBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  adviceBulletText: {
    flex: 1,
    fontSize: 13,
    color: '#78350f',
    lineHeight: 18,
    fontWeight: '500',
  },
  adviceEmptyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adviceEmptyNote: {
    fontSize: 13,
    color: COLORS.outline,
    fontStyle: 'italic',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
  },
  warningTextContainer: {
    flex: 1,
    marginLeft: 10,
  },
  warningHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  warningTitle: {
    fontSize: 13,
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
    marginBottom: 20,
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
  physicianMetaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  exportReportFullButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.secondary,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 20,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  exportReportFullButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  rawTextCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  rawText: {
    fontSize: 12,
    color: COLORS.onSurfaceVariant,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  imageSection: {
    marginBottom: 20,
  },
  rawImage: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    resizeMode: 'contain',
    backgroundColor: '#000',
  },
  // Verification Badges & Alerts Styles
  verifiedBadgeCard: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  badgeIconCircleGreen: {
    backgroundColor: '#d1fae5',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifiedBadgeTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#065f46',
  },
  verifiedBadgeSubtitle: {
    fontSize: 11,
    color: '#047857',
    marginTop: 2,
    lineHeight: 16,
  },
  greenPill: {
    backgroundColor: '#d1fae5',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  greenPillText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#065f46',
    letterSpacing: 0.5,
  },
  verificationAlertsContainer: {
    gap: 10,
    marginBottom: 14,
  },
  invalidLicenseCard: {
    backgroundColor: '#fef2f2',
    borderLeftWidth: 4,
    borderLeftColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 14,
    padding: 12,
  },
  badgeIconCircleRed: {
    backgroundColor: '#fee2e2',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invalidLicenseTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
  },
  invalidLicenseSubtitle: {
    fontSize: 11,
    color: '#b91c1c',
    marginTop: 2,
    lineHeight: 16,
  },
  redPill: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  redPillText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#991b1b',
    letterSpacing: 0.5,
  },
  missingSignatureCard: {
    backgroundColor: '#fffbeb',
    borderLeftWidth: 4,
    borderLeftColor: '#d97706',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 14,
    padding: 12,
  },
  badgeIconCircleAmber: {
    backgroundColor: '#fef3c7',
    borderRadius: 20,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  missingSignatureTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
  },
  missingSignatureSubtitle: {
    fontSize: 11,
    color: '#b45309',
    marginTop: 2,
    lineHeight: 16,
  },
  amberPill: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  amberPillText: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#92400e',
    letterSpacing: 0.5,
  },
  badgeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  badgeTextCol: {
    flex: 1,
  },
  badgeTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  /* Manage Alarms Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '85%',
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surfaceHigh,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  modalAlarmIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 103, 126, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  modalSubtitle: {
    fontSize: 12,
    color: COLORS.onSurfaceVariant,
    marginTop: 2,
  },
  modalCloseButton: {
    padding: 6,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceHigh,
  },
  modalBody: {
    paddingHorizontal: 22,
    paddingTop: 14,
    maxHeight: 420,
  },
  modalDescription: {
    fontSize: 13,
    color: COLORS.onSurfaceVariant,
    marginBottom: 16,
    lineHeight: 18,
  },
  medAlarmCard: {
    backgroundColor: COLORS.background,
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  medAlarmCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  medAlarmCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.primary,
    marginLeft: 8,
  },
  slotsContainer: {
    gap: 10,
  },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  slotRowActive: {
    borderColor: 'rgba(0, 103, 126, 0.3)',
    backgroundColor: 'rgba(0, 103, 126, 0.03)',
  },
  slotRowInactive: {
    borderColor: COLORS.surfaceHigh,
    opacity: 0.65,
  },
  slotToggleTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  slotEmoji: {
    fontSize: 18,
    marginHorizontal: 8,
  },
  slotLabelCol: {
    flex: 1,
  },
  slotLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
  },
  slotLabelActive: {
    color: COLORS.onSurface,
    fontWeight: '700',
  },
  slotSubtext: {
    fontSize: 11,
    color: COLORS.outline,
    marginTop: 1,
  },
  timePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(0, 103, 126, 0.25)',
    minWidth: 112,
    justifyContent: 'center',
    gap: 4,
  },
  timePickerButtonDisabled: {
    borderColor: COLORS.surfaceHigh,
    backgroundColor: COLORS.surfaceHigh,
    opacity: 0.6,
  },
  timePickerText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  timePickerTextDisabled: {
    color: COLORS.outline,
  },
  emptyModalCard: {
    padding: 24,
    alignItems: 'center',
  },
  emptyModalText: {
    fontSize: 14,
    color: COLORS.outline,
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceHigh,
    gap: 12,
  },
  modalCancelBtn: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceHigh,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
  },
  modalSaveBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 13,
    borderRadius: 12,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
  },
  modalSaveBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});
