import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  TouchableOpacity,
  Animated
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { FileSystemUploadType } from 'expo-file-system/legacy';
import { MaterialIcons } from '@expo/vector-icons';
import { API_BASE_URL } from '../constants/config';
import { COLORS } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { speakMedication, speakFullPrescription, stopSpeech, TTS_LANGUAGES } from '../services/ttsService';
import { scheduleMedicationAlarms } from '../services/notificationService';
import { exportPrescriptionPDF } from '../services/pdfExportService';
import { addMedicationToProfile as serviceAddMedication } from '../services/profileService';

const LOADING_STAGES = [
  { id: 0, title: 'Calling OCR API...', icon: 'document-scanner', desc: 'Transcribing clinical handwriting & print' },
  { id: 1, title: 'Calling NLP API...', icon: 'psychology', desc: 'Extracting medical entities & dosages' },
  { id: 2, title: 'Categorising...', icon: 'category', desc: 'Mapping strengths, forms & frequencies' },
  { id: 3, title: 'Validating...', icon: 'verified-user', desc: 'Verifying doctor license & signatures' },
];

export default function UploadScreen({ navigation }) {
  const { user, addMedicationToProfile } = useAuth();

  const handleAutoSaveMedication = async (matchedDrugData) => {
    try {
      if (typeof addMedicationToProfile === 'function') {
        await addMedicationToProfile(matchedDrugData);
      } else {
        await serviceAddMedication(matchedDrugData, user);
      }
    } catch (e) {
      console.warn('[AutoSave] Background medication save warning:', e);
    }
  };
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [results, setResults] = useState(null);
  const [editableMedications, setEditableMedications] = useState([]);
  const [isFinalized, setIsFinalized] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [showRawText, setShowRawText] = useState(false);
  const [comparingProfile, setComparingProfile] = useState(false);
  const [manualSafetyResults, setManualSafetyResults] = useState(null);
  const [speakingIndex, setSpeakingIndex] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState('en'); // 'en' | 'hi' | 'kn'
  const [translatingIndex, setTranslatingIndex] = useState(null); // null | 'all' | number
  const [exportingPdf, setExportingPdf] = useState(false);
  const [schedulingAlarms, setSchedulingAlarms] = useState(false);
  const [alarmsScheduled, setAlarmsScheduled] = useState(false);

  const stageTimerRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Cleanup active speech on unmount
  useEffect(() => {
    return () => {
      stopSpeech();
    };
  }, []);

  // Pulse animation for loading indicator
  useEffect(() => {
    if (loading) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [loading]);

  const pickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Required", "Media library access is needed to select prescriptions.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImage(result.assets[0].uri);
        setResults(null);
        setEditableMedications([]);
        setIsFinalized(false);
      }
    } catch (error) {
      console.error("Picker Error:", error);
      Alert.alert("Picker Error", "Failed to select image: " + (error?.message || error));
    }
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Permission Required", "Camera access is needed to capture prescriptions.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        setImage(result.assets[0].uri);
        setResults(null);
        setEditableMedications([]);
        setIsFinalized(false);
      }
    } catch (error) {
      console.error("Camera Error:", error);
      Alert.alert("Camera Error", "Failed to capture photo: " + (error?.message || error));
    }
  };

  const startStageTransitions = () => {
    setCurrentStage(0);
    let stage = 0;
    stageTimerRef.current = setInterval(() => {
      stage += 1;
      if (stage < LOADING_STAGES.length) {
        setCurrentStage(stage);
      }
    }, 1200);
  };

  const stopStageTransitions = () => {
    if (stageTimerRef.current) {
      clearInterval(stageTimerRef.current);
      stageTimerRef.current = null;
    }
  };

const NETWORK_TIMEOUT_MS = 120000; // 120 seconds to survive heavy Vision OCR and LLM processing

  // Endpoint 1: Extract OCR + spaCy data (No DB save, No safety engine)
  const uploadImage = async () => {
    if (!image) {
      Alert.alert("No Image", "Please select or take a photo of a prescription first.");
      return;
    }

    setLoading(true);
    setResults(null);
    setEditableMedications([]);
    setIsFinalized(false);
    setManualSafetyResults(null);
    startStageTransitions();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, NETWORK_TIMEOUT_MS);

    try {
      let resultData;
      let statusCode = 200;

      try {
        // Preferred: fetch with FormData + AbortController with 120s timeout
        const formData = new FormData();
        const filename = image.split('/').pop() || 'prescription.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const ext = match ? match[1].toLowerCase() : 'jpg';
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

        formData.append('file', {
          uri: image,
          name: filename,
          type: mimeType,
        });

        const fetchResponse = await fetch(`${API_BASE_URL}/scan/extract`, {
          method: 'POST',
          body: formData,
          headers: {
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });

        statusCode = fetchResponse.status;
        const textBody = await fetchResponse.text();
        try {
          resultData = JSON.parse(textBody);
        } catch {
          resultData = { detail: textBody };
        }
      } catch (fetchErr) {
        if (fetchErr?.name === 'AbortError' || controller.signal.aborted) {
          const timeoutError = new Error('Network timeout (120s limit exceeded) during OCR/LLM analysis');
          timeoutError.name = 'TimeoutError';
          throw timeoutError;
        }

        // Fallback to FileSystem.uploadAsync if FormData encounters local file URI issues
        console.warn("Direct fetch upload failed, falling back to FileSystem.uploadAsync:", fetchErr);
        const fsResponse = await FileSystem.uploadAsync(
          `${API_BASE_URL}/scan/extract`,
          image,
          {
            fieldName: 'file',
            httpMethod: 'POST',
            uploadType: FileSystemUploadType?.MULTIPART ?? 1,
            timeout: NETWORK_TIMEOUT_MS,
          }
        );

        statusCode = fsResponse.status;
        try {
          resultData = JSON.parse(fsResponse.body);
        } catch (parseError) {
          resultData = { detail: fsResponse.body };
        }
      }

      stopStageTransitions();

      if (statusCode >= 200 && statusCode < 300) {
        setResults(resultData);
        const rawMeds = resultData.medicines || resultData.prescribed_medications || [];
        const formatted = rawMeds.map((m, idx) => {
          if (typeof m === 'string') {
            return { drug_name: m, id: `med-${idx}` };
          }
          return {
            ...m,
            drug_name: m.drug_name || m.name || m.drug || '',
            id: m.id || `med-${idx}`,
          };
        });
        setEditableMedications(formatted);
        setIsFinalized(false);

        // OCR-to-Safety Handoff: Detect exact drug match and auto-save to Active Medications profile list
        const scannedDrugNames = resultData.scanned_drugs || formatted.map(m => m.drug_name).filter(Boolean);
        const isExactMatch = Boolean(scannedDrugNames && scannedDrugNames.length > 0);
        if (isExactMatch) {
          handleAutoSaveMedication(scannedDrugNames);
        }
      } else {
        console.error("Upload failed with status:", statusCode, resultData);
        Alert.alert("Analysis Failed", resultData?.detail || `Upload failed with status code ${statusCode}`);
      }
    } catch (error) {
      stopStageTransitions();
      console.error("Upload Error:", error);
      const isTimeout =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError' ||
        error?.message?.toLowerCase().includes('timeout') ||
        error?.message?.toLowerCase().includes('aborted');

      const alertMessage = isTimeout
        ? "Network timeout (120s limit exceeded). The OCR and LLM processing took longer than expected. Please check your connection and try again."
        : (error?.message || "Failed to upload and extract prescription.");

      Alert.alert(isTimeout ? "Upload Timeout" : "Upload Error", alertMessage);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      stopStageTransitions();
    }
  };

  // Endpoint 2: Finalize verified prescription (Run Safety Engine + Save to DB)
  const handleConfirmAndAnalyze = async () => {
    const validMeds = editableMedications.filter(m => (m.drug_name || '').trim().length > 0);
    if (validMeds.length === 0) {
      Alert.alert(
        "No Medications Specified",
        "Please enter at least one medication name before analyzing safety interactions.",
        [
          { text: "Add Medication", onPress: handleAddMedication },
          { text: "Cancel", style: "cancel" }
        ]
      );
      return;
    }

    setFinalizing(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
      const payload = {
        ...(results || {}),
        medicines: editableMedications,
        prescribed_medications: editableMedications,
      };

      const response = await fetch(`${API_BASE_URL}/scan/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Finalization failed with status ${response.status}`);
      }

      const finalData = await response.json();
      setResults(finalData);
      setIsFinalized(true);

      // OCR-to-Safety Handoff: Right after successful interaction check returns, auto-save matched medications
      const matchedMeds = finalData.scanned_drugs || editableMedications;
      const isExactMatch = Boolean(matchedMeds && matchedMeds.length > 0);
      if (isExactMatch) {
        await handleAutoSaveMedication(matchedMeds);
      }

      // STEP 3: Automatically schedule medication alarms when prescription is finalized & saved
      try {
        const pName = finalData.patient_name || (finalData.patient_details && finalData.patient_details.name) || '';
        const alarmRes = await scheduleMedicationAlarms(editableMedications, pName);
        if (alarmRes.success) {
          setAlarmsScheduled(true);
          console.log(`[NotificationService] Automatically scheduled ${alarmRes.count} daily medication alarms.`);
        }
      } catch (alarmErr) {
        console.warn("Could not auto-schedule medication alarms:", alarmErr);
      }
    } catch (err) {
      console.error("Error finalizing prescription:", err);
      const isTimeout =
        err?.name === 'AbortError' ||
        err?.message?.toLowerCase().includes('timeout') ||
        err?.message?.toLowerCase().includes('aborted');
      Alert.alert(
        isTimeout ? "Analysis Timeout" : "Analysis Error",
        isTimeout
          ? "Safety interaction analysis timed out after 120 seconds. Please try again."
          : (err.message || "Could not complete safety analysis & finalization.")
      );
    } finally {
      clearTimeout(timeoutId);
      setFinalizing(false);
    }
  };

  // STEP 2 & STEP 4 Utility Handlers
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
      await speakFullPrescription(results || {}, {
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

  const handleManualScheduleAlarms = async () => {
    const validMeds = results?.medicines || results?.prescribed_medications || editableMedications;
    const pName = results?.patient_name || (results?.patient_details && results?.patient_details.name) || '';
    try {
      setSchedulingAlarms(true);
      const res = await scheduleMedicationAlarms(validMeds, pName);
      if (res.success) {
        setAlarmsScheduled(true);
        Alert.alert(
          "Medication Alarms Scheduled ⏰",
          `Configured ${res.count} recurring daily alarms for this prescription:\n\n🌅 Morning: 8:00 AM\n☀️ Afternoon: 1:00 PM\n🌙 Night: 8:00 PM\n\nYou will receive timely notifications for each scheduled dosage.`,
          [{ text: "OK" }]
        );
      } else {
        Alert.alert("Alarms Setup", res.message || "Could not schedule alarms.");
      }
    } catch (e) {
      Alert.alert("Alarms Error", e.message || "Failed to set reminders.");
    } finally {
      setSchedulingAlarms(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      setExportingPdf(true);
      await exportPrescriptionPDF(results || {});
    } catch (e) {
      Alert.alert("Export Error", e.message || "Failed to export PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  const handleDrugNameChange = (text, index) => {
    setEditableMedications(prev => {
      const updated = [...prev];
      updated[index] = {
        ...updated[index],
        drug_name: text,
        name: text,
        drug: text,
      };
      return updated;
    });
  };

  const handleAddMedication = () => {
    setEditableMedications(prev => [
      ...prev,
      {
        drug_name: '',
        strength: '',
        form: 'Tablet',
        frequency: 'Once daily',
        instructions: 'As directed by physician',
        schedule_text: 'Once daily (Morning)',
        schedule_slots: { morning: true, afternoon: false, night: false },
        id: `med-${Date.now()}`
      }
    ]);
  };

  const handleRemoveMedication = (index) => {
    setEditableMedications(prev => prev.filter((_, i) => i !== index));
  };

  const resetAll = () => {
    setImage(null);
    setResults(null);
    setEditableMedications([]);
    setIsFinalized(false);
    setFinalizing(false);
    setShowRawText(false);
    setManualSafetyResults(null);
  };

  const patientName = results?.patient_name || results?.patient_details?.name;
  const patientAge = results?.patient_age || results?.patient_details?.age;
  const patientSex = results?.patient_sex || results?.patient_details?.sex;
  const doctorName = results?.doctor_name;
  const hospitalName = results?.hospital_name;
  const licenseCode = results?.license_code || results?.doctor_license_number || results?.doctor_id;

  // Doctor Verification Module attributes
  const verification = results?.verification || {};
  const licenseStatus = verification?.license_status || (results?.doctor_license_validated ? 'Valid' : (licenseCode ? 'Invalid' : 'Not Found'));
  const signaturePresent = verification?.signature_present !== undefined 
    ? Boolean(verification.signature_present) 
    : Boolean(results?.signature_verified || results?.sign_present);

  const isLicenseValid = licenseStatus === 'Valid';
  const isFullyVerified = isLicenseValid && signaturePresent === true;
  const isLicenseInvalid = licenseStatus === 'Suspended' || licenseStatus === 'Invalid' || licenseStatus === 'Not Found';
  const isSignatureMissing = signaturePresent === false;

  const rawTextContent = results?.extracted_raw_text || results?.raw_text;
  const doctorAdvice = results?.doctor_suggestions || results?.doctor_advice || [];
  const diseases = results?.diseases_identified || [];
  const validMedicines = (results?.medicines || []).filter(item => item && (item.drug_name || item.name || item.drug));
  const isOwner = results?.is_owner === true;
  const interactions = results?.interactions || results?.warnings || [];
  const scannedDrugs = results?.scanned_drugs || validMedicines.map(m => m.drug_name || m.name || m.drug).filter(Boolean);

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

    setComparingProfile(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    try {
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
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Safety check failed with status ${response.status}`);
      }

      const checkData = await response.json();
      setManualSafetyResults(checkData.interactions || []);

      // OCR-to-Safety Handoff: Right after successful interaction check returns, auto-save matched medications
      const isExactMatch = Boolean(scannedDrugs && scannedDrugs.length > 0);
      if (isExactMatch) {
        await handleAutoSaveMedication(scannedDrugs);
      }
    } catch (err) {
      console.error("Error checking profile DDI:", err);
      const isTimeout =
        err?.name === 'AbortError' ||
        err?.message?.toLowerCase().includes('timeout') ||
        err?.message?.toLowerCase().includes('aborted');
      Alert.alert(
        isTimeout ? "Safety Check Timeout" : "Safety Engine Error",
        isTimeout
          ? "Safety interaction analysis timed out after 120 seconds. Please try again."
          : (err.message || "Could not complete safety analysis.")
      );
    } finally {
      clearTimeout(timeoutId);
      setComparingProfile(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.headerCategory}>AI VISION SCANNER</Text>
        <Text style={styles.headerTitle}>Scan Prescription</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Step 1: Upload / Capture Selector */}
        {!results && (
          <View style={styles.selectionCard}>
            {image ? (
              <View style={styles.imagePreviewBox}>
                <Image source={{ uri: image }} style={styles.prescriptionImage} />
                <TouchableOpacity style={styles.changeImageBadge} onPress={resetAll}>
                  <MaterialIcons name="refresh" size={16} color="#fff" />
                  <Text style={styles.changeImageText}>Change Image</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.emptyPickerBox}>
                <MaterialIcons name="add-a-photo" size={54} color={COLORS.outlineVariant} />
                <Text style={styles.pickerHintTitle}>Upload Prescription Document</Text>
                <Text style={styles.pickerHintSub}>Capture from camera or choose an image from your library</Text>
                
                <View style={styles.pickerButtonRow}>
                  <TouchableOpacity style={styles.secondaryButton} onPress={takePhoto}>
                    <MaterialIcons name="camera-alt" size={18} color={COLORS.primary} />
                    <Text style={styles.secondaryButtonText}>Take Photo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.primaryButton} onPress={pickImage}>
                    <MaterialIcons name="photo-library" size={18} color="#fff" />
                    <Text style={styles.primaryButtonText}>Browse Library</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {image && !loading && (
              <TouchableOpacity
                style={styles.extractActionButton}
                onPress={uploadImage}
                activeOpacity={0.85}
              >
                <MaterialIcons name="auto-awesome" size={20} color="#fff" />
                <Text style={styles.extractButtonText}>Extract Medications</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Dynamic Multi-Step Loading Indicator */}
        {loading && (
          <View style={styles.loadingContainer}>
            <Animated.View style={[styles.loadingPulseCard, { transform: [{ scale: pulseAnim }] }]}>
              <ActivityIndicator size="large" color={COLORS.primary} style={styles.loadingSpinner} />
              <Text style={styles.activeStageTitle}>{LOADING_STAGES[currentStage].title}</Text>
              <Text style={styles.activeStageDesc}>{LOADING_STAGES[currentStage].desc}</Text>

              {/* Sequential Steps List */}
              <View style={styles.stepsList}>
                {LOADING_STAGES.map((stg) => {
                  const isDone = currentStage > stg.id;
                  const isActive = currentStage === stg.id;
                  return (
                    <View key={stg.id} style={styles.stepItemRow}>
                      <View style={[
                        styles.stepBullet,
                        isDone && styles.stepBulletDone,
                        isActive && styles.stepBulletActive
                      ]}>
                        {isDone ? (
                          <MaterialIcons name="check" size={14} color="#fff" />
                        ) : (
                          <MaterialIcons
                            name={stg.icon}
                            size={14}
                            color={isActive ? '#fff' : COLORS.outline}
                          />
                        )}
                      </View>
                      <Text style={[
                        styles.stepText,
                        isDone && styles.stepTextDone,
                        isActive && styles.stepTextActive
                      ]}>
                        {stg.title}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        )}

        {/* ======================================================================= */}
        {/* PHASE 1: HUMAN-IN-THE-LOOP (HITL) VERIFICATION UI (results && !isFinalized) */}
        {/* ======================================================================= */}
        {results && !isFinalized && (
          <View style={styles.resultsWrapper}>
            {/* Header with Step Indicator */}
            <View style={styles.resultsHeaderRow}>
              <View>
                <Text style={styles.stepBadgeText}>HUMAN-IN-THE-LOOP</Text>
                <Text style={styles.resultsSectionTitle}>Review Extracted Data</Text>
              </View>
              <TouchableOpacity style={styles.scanNewButton} onPress={resetAll}>
                <MaterialIcons name="refresh" size={16} color={COLORS.primary} />
                <Text style={styles.scanNewText}>Rescan</Text>
              </TouchableOpacity>
            </View>

            {/* Prominent HITL Explanation Banner */}
            <View style={styles.hitlBannerCard}>
              <View style={styles.hitlIconCircle}>
                <MaterialIcons name="edit-note" size={24} color={COLORS.primary} />
              </View>
              <View style={styles.hitlTextContainer}>
                <Text style={styles.hitlBannerTitle}>Verify & Correct Medication Names</Text>
                <Text style={styles.hitlBannerDesc}>
                  Please review the transcribed medication names below. Tap any name to correct handwriting spelling errors before running the safety interaction engine.
                </Text>
              </View>
            </View>

            {/* Demographics & Clinic Info */}
            <View style={styles.metaCard}>
              <View style={styles.sectionTitleHeaderRow}>
                <MaterialIcons name="local-hospital" size={18} color={COLORS.primary} />
                <Text style={styles.metaCardHeader}>DETECTED PATIENT & CLINIC</Text>
              </View>
              
              <View style={styles.metaGrid}>
                {hospitalName ? (
                  <View style={styles.metaRow}>
                    <MaterialIcons name="business" size={16} color={COLORS.primary} style={styles.metaIcon} />
                    <Text style={styles.metaLabel}>Clinic/Hospital:</Text>
                    <Text style={styles.metaValue}>{hospitalName}</Text>
                  </View>
                ) : null}

                {patientName ? (
                  <View style={styles.metaRow}>
                    <MaterialIcons name="person" size={16} color={COLORS.primary} style={styles.metaIcon} />
                    <Text style={styles.metaLabel}>Patient:</Text>
                    <Text style={styles.metaValue}>
                      {patientName} {patientAge ? `(${patientAge} yrs)` : ''} {patientSex ? `• ${patientSex}` : ''}
                    </Text>
                  </View>
                ) : null}

                {diseases && diseases.length > 0 ? (
                  <View style={styles.metaRow}>
                    <MaterialIcons name="healing" size={16} color={COLORS.primary} style={styles.metaIcon} />
                    <Text style={styles.metaLabel}>Diagnosis / Dx:</Text>
                    <Text style={styles.metaValue}>{diseases.join(', ')}</Text>
                  </View>
                ) : null}

                {!hospitalName && !patientName && (!diseases || diseases.length === 0) && (
                  <Text style={styles.emptySubtext}>Patient and clinic header details not detected.</Text>
                )}
              </View>
            </View>

            {/* Editable Prescribed Medications Section */}
            <View style={styles.medsSection}>
              <View style={styles.medsHeaderRowBetween}>
                <View>
                  <Text style={styles.sectionHeading}>
                    Prescribed Medications ({editableMedications.length})
                  </Text>
                  <Text style={styles.sectionSubheading}>Tap medicine name to edit spelling</Text>
                </View>
                <TouchableOpacity style={styles.addMedButton} onPress={handleAddMedication}>
                  <MaterialIcons name="add" size={16} color={COLORS.primary} />
                  <Text style={styles.addMedButtonText}>Add Drug</Text>
                </TouchableOpacity>
              </View>

              {editableMedications.length > 0 ? (
                editableMedications.map((item, index) => {
                  const drugTitle = item.drug_name || '';
                  const strength = item.strength || item.dosage;
                  const form = item.form;
                  const frequency = item.frequency;
                  const duration = item.duration;
                  const timing = item.timing;
                  const scheduleText = item.schedule_text || item.schedule;
                  const scheduleSlots = item.schedule_slots;

                  return (
                    <View key={item.id || index} style={styles.editableMedicineCard}>
                      {/* Card Header with Pill Number and Delete Icon */}
                      <View style={styles.editableMedCardHeader}>
                        <View style={styles.medPillIndexBadge}>
                          <MaterialIcons name="medication" size={14} color={COLORS.primary} />
                          <Text style={styles.medPillIndexText}>MEDICATION #{index + 1}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.deleteMedButton}
                          onPress={() => handleRemoveMedication(index)}
                        >
                          <MaterialIcons name="close" size={18} color={COLORS.outline} />
                        </TouchableOpacity>
                      </View>

                      {/* Clean Editable TextInput for Medication Name */}
                      <View style={styles.inputWrapper}>
                        <Text style={styles.inputFieldLabel}>MEDICATION NAME</Text>
                        <View style={styles.textInputBox}>
                          <TextInput
                            style={styles.medTextInput}
                            value={drugTitle}
                            onChangeText={(text) => handleDrugNameChange(text, index)}
                            placeholder="e.g. Amoxicillin 500mg"
                            placeholderTextColor={COLORS.outlineVariant}
                            autoCapitalize="words"
                            autoCorrect={false}
                          />
                          <View style={styles.editIconBadge}>
                            <MaterialIcons name="edit" size={16} color={COLORS.primary} />
                          </View>
                        </View>
                      </View>

                      {/* Dosage Schedule Chips & Indicators */}
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
                                  <Text style={[styles.timeSlotText, styles.slotMorningText]}>Morning</Text>
                                </View>
                              ) : null}
                              {scheduleSlots.afternoon ? (
                                <View style={[styles.timeSlotChip, styles.slotAfternoon]}>
                                  <Text style={styles.slotEmoji}>☀️</Text>
                                  <Text style={[styles.timeSlotText, styles.slotAfternoonText]}>Afternoon</Text>
                                </View>
                              ) : null}
                              {scheduleSlots.night ? (
                                <View style={[styles.timeSlotChip, styles.slotNight]}>
                                  <Text style={styles.slotEmoji}>🌙</Text>
                                  <Text style={[styles.timeSlotText, styles.slotNightText]}>Night</Text>
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      ) : null}

                      {/* Chips / Badges for Strength, Form, Frequency, Duration, Timing */}
                      <View style={styles.chipsContainer}>
                        {strength ? (
                          <View style={styles.chip}>
                            <Text style={styles.chipText}>Strength: {strength}</Text>
                          </View>
                        ) : null}
                        {form ? (
                          <View style={[styles.chip, { backgroundColor: '#e0f2fe' }]}>
                            <Text style={[styles.chipText, { color: '#0369a1' }]}>Form: {form}</Text>
                          </View>
                        ) : null}
                        {frequency ? (
                          <View style={[styles.chip, { backgroundColor: '#fef3c7' }]}>
                            <Text style={[styles.chipText, { color: '#92400e' }]}>{frequency}</Text>
                          </View>
                        ) : null}
                        {duration ? (
                          <View style={[styles.chip, { backgroundColor: '#dcfce7' }]}>
                            <Text style={[styles.chipText, { color: '#166534' }]}>{duration}</Text>
                          </View>
                        ) : null}
                        {timing ? (
                          <View style={[styles.chip, { backgroundColor: '#f3e8ff' }]}>
                            <Text style={[styles.chipText, { color: '#6b21a8' }]}>{timing}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.noMedCard}>
                  <MaterialIcons name="info-outline" size={24} color={COLORS.outline} />
                  <Text style={styles.noMedText}>No medications detected. Tap "+ Add Drug" to enter medications manually.</Text>
                </View>
              )}
            </View>

            {/* Doctor Authentication Info */}
            <View style={styles.footerMetaCard}>
              <View style={styles.sectionTitleHeaderRow}>
                <MaterialIcons name="verified-user" size={18} color={COLORS.primary} />
                <Text style={styles.metaCardHeader}>PHYSICIAN & AUTHENTICATION</Text>
              </View>

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
                  <View style={styles.metaRow}>
                    <MaterialIcons name="medical-services" size={16} color={COLORS.primary} style={styles.metaIcon} />
                    <Text style={styles.metaLabel}>Physician:</Text>
                    <Text style={styles.metaValue}>Dr. {doctorName}</Text>
                  </View>
                ) : null}

                <View style={styles.metaRow}>
                  <MaterialIcons
                    name="badge"
                    size={16}
                    color={isLicenseValid ? "#059669" : "#dc2626"}
                    style={styles.metaIcon}
                  />
                  <Text style={styles.metaLabel}>License / Reg:</Text>
                  <Text style={[styles.metaValue, { color: isLicenseValid ? "#059669" : "#dc2626" }]}>
                    {licenseCode ? `${licenseCode} (${licenseStatus})` : 'Not Specified'}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <MaterialIcons
                    name={signaturePresent ? "verified" : "warning"}
                    size={16}
                    color={signaturePresent ? "#059669" : "#d97706"}
                    style={styles.metaIcon}
                  />
                  <Text style={styles.metaLabel}>Signature:</Text>
                  <Text style={[styles.metaValue, { color: signaturePresent ? "#059669" : "#d97706" }]}>
                    {signaturePresent ? "Doctor Signature Detected" : "Missing Doctor Signature"}
                  </Text>
                </View>
              </View>
            </View>

            {/* LARGE PRIMARY BUTTON: Confirm & Analyze */}
            <TouchableOpacity
              style={[styles.confirmActionButton, finalizing && styles.confirmActionButtonDisabled]}
              onPress={handleConfirmAndAnalyze}
              disabled={finalizing}
              activeOpacity={0.85}
            >
              {finalizing ? (
                <View style={styles.buttonLoadingRow}>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.confirmButtonText}>Running Safety Engine & Saving...</Text>
                </View>
              ) : (
                <View style={styles.buttonContentRow}>
                  <MaterialIcons name="fact-check" size={22} color="#fff" />
                  <Text style={styles.confirmButtonText}>Confirm & Analyze</Text>
                </View>
              )}
            </TouchableOpacity>

          </View>
        )}

        {/* ======================================================================= */}
        {/* PHASE 2: FINALIZED RESULTS & SAFETY INTERACTION ALERTS (results && isFinalized) */}
        {/* ======================================================================= */}
        {results && isFinalized && (
          <View style={styles.resultsWrapper}>
            
            {/* Action Bar Header */}
            <View style={styles.resultsHeaderRow}>
              <View>
                <Text style={styles.stepBadgeSuccess}>SAVED TO DATABASE</Text>
                <Text style={styles.resultsSectionTitle}>Prescription Analysis</Text>
              </View>
              <TouchableOpacity style={styles.scanNewButton} onPress={resetAll}>
                <MaterialIcons name="add" size={16} color={COLORS.primary} />
                <Text style={styles.scanNewText}>Scan New</Text>
              </TouchableOpacity>
            </View>

            {/* PATIENT UTILITY ACTION TOOLBAR (TTS, Alarms, PDF Export) */}
            <View style={styles.uploadUtilityCard}>
              <View style={styles.uploadUtilityHeaderRow}>
                <Text style={styles.uploadUtilityTitle}>PATIENT CARE UTILITIES</Text>
                {selectedLanguage !== 'en' && (
                  <View style={styles.uploadActiveLangTag}>
                    <MaterialIcons name="record-voice-over" size={12} color={COLORS.primary} />
                    <Text style={styles.uploadActiveLangText}>
                      {selectedLanguage === 'hi' ? 'Hindi TTS (hi-IN)' : 'Kannada TTS (kn-IN)'}
                    </Text>
                  </View>
                )}
              </View>

              {/* Read Aloud Language Selection Toggle */}
              <View style={styles.uploadTtsLangSelector}>
                <View style={styles.uploadTtsLangHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="translate" size={14} color={COLORS.primary} />
                    <Text style={styles.uploadTtsLangLabel}>Read-Aloud Language</Text>
                  </View>
                  {translatingIndex !== null && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <ActivityIndicator size="small" color={COLORS.primary} style={{ transform: [{ scale: 0.7 }] }} />
                      <Text style={{ fontSize: 11, color: COLORS.primary, fontStyle: 'italic' }}>Translating...</Text>
                    </View>
                  )}
                </View>

                <View style={styles.uploadTtsLangToggleRow}>
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
                          styles.uploadTtsLangBtn,
                          isSelected && styles.uploadTtsLangBtnActive,
                        ]}
                        onPress={() => handleSelectLanguage(lang.code)}
                        activeOpacity={0.7}
                      >
                        <Text
                          style={[
                            styles.uploadTtsLangBtnText,
                            isSelected && styles.uploadTtsLangBtnTextActive,
                          ]}
                        >
                          {lang.label}
                        </Text>
                        <Text
                          style={[
                            styles.uploadTtsLangBtnSub,
                            isSelected && styles.uploadTtsLangBtnSubActive,
                          ]}
                        >
                          {lang.sub}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.uploadUtilityGrid}>
                {/* 1. TTS Read Aloud */}
                <TouchableOpacity 
                  style={[styles.uploadUtilBtn, speakingIndex === 'all' && styles.uploadUtilBtnActive]} 
                  onPress={handleToggleSpeakAll}
                  activeOpacity={0.8}
                >
                  <View style={[styles.uploadUtilIconCircle, speakingIndex === 'all' && styles.uploadUtilIconCircleActive]}>
                    {translatingIndex === 'all' ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <MaterialIcons 
                        name={speakingIndex === 'all' ? "stop" : "volume-up"} 
                        size={18} 
                        color={speakingIndex === 'all' ? "#ffffff" : COLORS.primary} 
                      />
                    )}
                  </View>
                  <Text style={[styles.uploadUtilBtnText, speakingIndex === 'all' && styles.uploadUtilBtnTextActive]}>
                    {speakingIndex === 'all' 
                      ? (translatingIndex === 'all' ? "Translating..." : "Stop Audio") 
                      : (selectedLanguage === 'en' ? "Read Aloud" : `Read (${selectedLanguage.toUpperCase()})`)}
                  </Text>
                </TouchableOpacity>

                {/* 2. Automated Medication Alarms */}
                <TouchableOpacity 
                  style={[styles.uploadUtilBtn, alarmsScheduled && styles.uploadUtilBtnSuccess]} 
                  onPress={handleManualScheduleAlarms}
                  disabled={schedulingAlarms}
                  activeOpacity={0.8}
                >
                  <View style={[styles.uploadUtilIconCircle, alarmsScheduled && styles.uploadUtilIconCircleSuccess]}>
                    {schedulingAlarms ? (
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    ) : (
                      <MaterialIcons 
                        name={alarmsScheduled ? "alarm-on" : "alarm-add"} 
                        size={18} 
                        color={alarmsScheduled ? "#ffffff" : "#d97706"} 
                      />
                    )}
                  </View>
                  <Text style={[styles.uploadUtilBtnText, alarmsScheduled && styles.uploadUtilBtnTextSuccess]}>
                    {alarmsScheduled ? "Alarms Active" : "Set Alarms"}
                  </Text>
                </TouchableOpacity>

                {/* 3. Export PDF Report */}
                <TouchableOpacity 
                  style={styles.uploadUtilBtn} 
                  onPress={handleExportPDF}
                  disabled={exportingPdf}
                  activeOpacity={0.8}
                >
                  <View style={[styles.uploadUtilIconCircle, { backgroundColor: '#e0f2fe' }]}>
                    {exportingPdf ? (
                      <ActivityIndicator size="small" color="#0369a1" />
                    ) : (
                      <MaterialIcons name="share" size={18} color="#0284c7" />
                    )}
                  </View>
                  <Text style={styles.uploadUtilBtnText}>
                    {exportingPdf ? "Exporting..." : "Export PDF"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Top Safety & Profile Verification Section */}
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
                        Matched profile: {user?.name || 'Registered Patient'} • Clinical risk detected with your active regimen.
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
                            {item.description || item.message || item.interaction || 'Potential clinical interaction between these drugs.'}
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
                      Prescription matched to {user?.name || 'your profile'}. No harmful drug interactions detected with your active medications.
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

            {/* Section 1: Top Clinical & Patient Demographics Card */}
            <View style={styles.metaCard}>
              <View style={styles.sectionTitleHeaderRow}>
                <MaterialIcons name="local-hospital" size={18} color={COLORS.primary} />
                <Text style={styles.metaCardHeader}>CLINIC & PATIENT INFORMATION</Text>
              </View>
              
              <View style={styles.metaGrid}>
                {hospitalName ? (
                  <View style={styles.metaRow}>
                    <MaterialIcons name="business" size={16} color={COLORS.primary} style={styles.metaIcon} />
                    <Text style={styles.metaLabel}>Clinic/Hospital:</Text>
                    <Text style={styles.metaValue}>{hospitalName}</Text>
                  </View>
                ) : null}

                {patientName ? (
                  <View style={styles.metaRow}>
                    <MaterialIcons name="person" size={16} color={COLORS.primary} style={styles.metaIcon} />
                    <Text style={styles.metaLabel}>Patient:</Text>
                    <Text style={styles.metaValue}>
                      {patientName} {patientAge ? `(${patientAge} yrs)` : ''} {patientSex ? `• ${patientSex}` : ''}
                    </Text>
                  </View>
                ) : null}

                {diseases && diseases.length > 0 ? (
                  <View style={styles.metaRow}>
                    <MaterialIcons name="healing" size={16} color={COLORS.primary} style={styles.metaIcon} />
                    <Text style={styles.metaLabel}>Diagnosis / Dx:</Text>
                    <Text style={styles.metaValue}>{diseases.join(', ')}</Text>
                  </View>
                ) : null}

                {!hospitalName && !patientName && (!diseases || diseases.length === 0) && (
                  <Text style={styles.emptySubtext}>Patient and clinic header details not detected.</Text>
                )}
              </View>
            </View>

            {/* Section 2: Verified Medications List */}
            <View style={styles.medsSection}>
              <View style={styles.medsHeaderRowBetween}>
                <Text style={styles.sectionHeading}>
                  Verified Prescribed Medications ({validMedicines.length})
                </Text>
                <TouchableOpacity
                  style={styles.editAgainButton}
                  onPress={() => setIsFinalized(false)}
                >
                  <MaterialIcons name="edit" size={14} color={COLORS.primary} />
                  <Text style={styles.editAgainText}>Edit Meds</Text>
                </TouchableOpacity>
              </View>

              {validMedicines.length > 0 ? (
                validMedicines.map((item, index) => {
                  const drugTitle = item.drug_name || item.name || item.drug || 'Medication';
                  const strength = item.strength || item.dosage;
                  const form = item.form;
                  const frequency = item.frequency;
                  const duration = item.duration;
                  const timing = item.timing;
                  const scheduleText = item.schedule_text || item.schedule;
                  const scheduleSlots = item.schedule_slots;
                  const instructions = item.instructions || item.dosage_formatted || item.details;

                  return (
                    <View key={index} style={styles.medicineCard}>
                      <View style={styles.medCardTop}>
                        <View style={styles.medIconBox}>
                          <MaterialIcons name="medication" size={22} color={COLORS.primary} />
                        </View>
                        <View style={styles.medTitleContainer}>
                          <Text style={styles.medTitle}>{drugTitle}</Text>
                          {instructions ? (
                            <Text style={styles.medInstructions}>{instructions}</Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          style={[styles.ttsSpeakerButton, speakingIndex === index && styles.ttsSpeakerButtonActive]}
                          onPress={() => handleToggleSpeakMedication(item, index)}
                          activeOpacity={0.8}
                        >
                          {translatingIndex === index ? (
                            <ActivityIndicator size="small" color={speakingIndex === index ? "#ffffff" : COLORS.primary} style={{ transform: [{ scale: 0.7 }] }} />
                          ) : (
                            <MaterialIcons 
                              name="volume-up" 
                              size={16} 
                              color={speakingIndex === index ? "#ffffff" : COLORS.primary} 
                            />
                          )}
                          <Text style={[styles.ttsSpeakerText, speakingIndex === index && styles.ttsSpeakerTextActive]}>
                            {speakingIndex === index 
                              ? (translatingIndex === index ? "Translating..." : "Speaking...") 
                              : (selectedLanguage === 'en' ? "Read" : `Read (${selectedLanguage.toUpperCase()})`)}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Dedicated Schedule Badge & Visual Time Chips */}
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
                                  <Text style={[styles.timeSlotText, styles.slotMorningText]}>Morning</Text>
                                </View>
                              ) : null}
                              {scheduleSlots.afternoon ? (
                                <View style={[styles.timeSlotChip, styles.slotAfternoon]}>
                                  <Text style={styles.slotEmoji}>☀️</Text>
                                  <Text style={[styles.timeSlotText, styles.slotAfternoonText]}>Afternoon</Text>
                                </View>
                              ) : null}
                              {scheduleSlots.night ? (
                                <View style={[styles.timeSlotChip, styles.slotNight]}>
                                  <Text style={styles.slotEmoji}>🌙</Text>
                                  <Text style={[styles.timeSlotText, styles.slotNightText]}>Night</Text>
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                        </View>
                      ) : null}

                      {/* Chips / Badges for Strength, Form, Frequency, Duration, Timing */}
                      <View style={styles.chipsContainer}>
                        {strength ? (
                          <View style={styles.chip}>
                            <Text style={styles.chipText}>Strength: {strength}</Text>
                          </View>
                        ) : null}
                        {form ? (
                          <View style={[styles.chip, { backgroundColor: '#e0f2fe' }]}>
                            <Text style={[styles.chipText, { color: '#0369a1' }]}>Form: {form}</Text>
                          </View>
                        ) : null}
                        {frequency ? (
                          <View style={[styles.chip, { backgroundColor: '#fef3c7' }]}>
                            <Text style={[styles.chipText, { color: '#92400e' }]}>{frequency}</Text>
                          </View>
                        ) : null}
                        {duration ? (
                          <View style={[styles.chip, { backgroundColor: '#dcfce7' }]}>
                            <Text style={[styles.chipText, { color: '#166534' }]}>{duration}</Text>
                          </View>
                        ) : null}
                        {timing ? (
                          <View style={[styles.chip, { backgroundColor: '#f3e8ff' }]}>
                            <Text style={[styles.chipText, { color: '#6b21a8' }]}>{timing}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={styles.noMedCard}>
                  <MaterialIcons name="info-outline" size={24} color={COLORS.outline} />
                  <Text style={styles.noMedText}>No valid medications recorded.</Text>
                </View>
              )}
            </View>

            {/* Section 3: Dedicated Doctor's Advice & Clinical Instructions */}
            <View style={styles.adviceCard}>
              <View style={styles.sectionTitleHeaderRow}>
                <MaterialIcons name="tips-and-updates" size={18} color="#92400e" />
                <Text style={styles.adviceCardHeader}>DOCTOR'S ADVICE & INSTRUCTIONS</Text>
              </View>

              {doctorAdvice && doctorAdvice.length > 0 ? (
                <View style={styles.adviceList}>
                  {doctorAdvice.map((adv, idx) => (
                    <View key={idx} style={styles.adviceItemRow}>
                      <MaterialIcons name="check-circle" size={16} color="#d97706" style={{ marginTop: 2 }} />
                      <Text style={styles.adviceText}>{adv}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.adviceEmptyRow}>
                  <MaterialIcons name="info-outline" size={16} color={COLORS.outline} />
                  <Text style={styles.adviceEmptyText}>No specific lifestyle or dietary advice noted on prescription.</Text>
                </View>
              )}
            </View>

            {/* Section 4: Physician & Authentication Metadata Footer */}
            <View style={styles.footerMetaCard}>
              <View style={styles.sectionTitleHeaderRow}>
                <MaterialIcons name="verified-user" size={18} color={COLORS.primary} />
                <Text style={styles.metaCardHeader}>PHYSICIAN & AUTHENTICATION</Text>
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
                  <View style={styles.metaRow}>
                    <MaterialIcons name="medical-services" size={16} color={COLORS.primary} style={styles.metaIcon} />
                    <Text style={styles.metaLabel}>Physician:</Text>
                    <Text style={styles.metaValue}>Dr. {doctorName}</Text>
                  </View>
                ) : null}

                <View style={styles.metaRow}>
                  <MaterialIcons
                    name="badge"
                    size={16}
                    color={isLicenseValid ? "#059669" : "#dc2626"}
                    style={styles.metaIcon}
                  />
                  <Text style={styles.metaLabel}>License / Reg:</Text>
                  <Text style={[styles.metaValue, { color: isLicenseValid ? "#059669" : "#dc2626" }]}>
                    {licenseCode ? `${licenseCode} (${licenseStatus})` : 'Not Specified'}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <MaterialIcons
                    name={signaturePresent ? "verified" : "warning"}
                    size={16}
                    color={signaturePresent ? "#059669" : "#d97706"}
                    style={styles.metaIcon}
                  />
                  <Text style={styles.metaLabel}>Signature:</Text>
                  <Text style={[styles.metaValue, { color: signaturePresent ? "#059669" : "#d97706" }]}>
                    {signaturePresent ? "Doctor Signature Detected" : "Missing Doctor Signature"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Expandable Accordion: Extracted Raw Text */}
            <View style={styles.rawTextAccordion}>
              <TouchableOpacity
                style={styles.accordionHeader}
                onPress={() => setShowRawText(!showRawText)}
                activeOpacity={0.8}
              >
                <View style={styles.accordionTitleRow}>
                  <MaterialIcons name="subject" size={20} color={COLORS.onSurface} />
                  <Text style={styles.accordionTitle}>Extracted Raw Text</Text>
                </View>
                <MaterialIcons
                  name={showRawText ? "expand-less" : "expand-more"}
                  size={24}
                  color={COLORS.outline}
                />
              </TouchableOpacity>

              {showRawText && (
                <View style={styles.accordionBody}>
                  <Text style={styles.rawMonospaceText}>
                    {rawTextContent || "No raw text available"}
                  </Text>
                </View>
              )}
            </View>

            {/* Details Navigation Button */}
            <TouchableOpacity
              style={styles.fullAnalysisNavButton}
              onPress={() => navigation.navigate('PrescriptionDetails', { data: results, imageUri: image })}
              activeOpacity={0.85}
            >
              <Text style={styles.fullAnalysisNavText}>View Full Safety & Interaction Details</Text>
              <MaterialIcons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>

            {/* Export PDF Full Button */}
            <TouchableOpacity
              style={styles.uploadExportPdfButton}
              onPress={handleExportPDF}
              disabled={exportingPdf}
              activeOpacity={0.85}
            >
              {exportingPdf ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <>
                  <MaterialIcons name="picture-as-pdf" size={20} color="#ffffff" />
                  <Text style={styles.uploadExportPdfButtonText}>Export Official Medical PDF Report</Text>
                </>
              )}
            </TouchableOpacity>

          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerCategory: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.primary,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  selectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  emptyPickerBox: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  pickerHintTitle: {
    fontSize: 17,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginTop: 12,
  },
  pickerHintSub: {
    fontSize: 13,
    color: COLORS.outline,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  pickerButtonRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-between',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surfaceLow,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  secondaryButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 14,
  },
  primaryButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  imagePreviewBox: {
    alignItems: 'center',
  },
  prescriptionImage: {
    width: '100%',
    height: 240,
    borderRadius: 16,
    resizeMode: 'contain',
    backgroundColor: '#000',
  },
  changeImageBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    marginTop: 12,
  },
  changeImageText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  extractActionButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  extractButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  loadingContainer: {
    marginVertical: 20,
  },
  loadingPulseCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  loadingSpinner: {
    marginBottom: 16,
  },
  activeStageTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: 4,
  },
  activeStageDesc: {
    fontSize: 13,
    color: COLORS.outline,
    marginBottom: 20,
    textAlign: 'center',
  },
  stepsList: {
    width: '100%',
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 16,
    padding: 16,
  },
  stepItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  stepBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceHigh,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepBulletActive: {
    backgroundColor: COLORS.primary,
  },
  stepBulletDone: {
    backgroundColor: '#198754',
  },
  stepText: {
    fontSize: 13,
    color: COLORS.outline,
    fontWeight: '500',
  },
  stepTextActive: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  stepTextDone: {
    color: '#198754',
    fontWeight: '600',
  },
  resultsWrapper: {
    marginTop: 4,
  },
  resultsHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  stepBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  stepBadgeSuccess: {
    fontSize: 10,
    fontWeight: '800',
    color: '#059669',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  resultsSectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  scanNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLow,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  scanNewText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginLeft: 4,
  },
  hitlBannerCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#eff6ff',
    borderWidth: 1.5,
    borderColor: '#bfdbfe',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  hitlIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#dbeafe',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  hitlTextContainer: {
    flex: 1,
  },
  hitlBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1e40af',
    marginBottom: 4,
  },
  hitlBannerDesc: {
    fontSize: 12,
    color: '#1e3a8a',
    lineHeight: 17,
  },
  metaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  metaCardHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    color: COLORS.outline,
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  metaGrid: {
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaIcon: {
    marginRight: 8,
  },
  metaLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.outline,
    width: 100,
  },
  metaValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    flex: 1,
  },
  medsSection: {
    marginBottom: 16,
  },
  medsHeaderRowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  sectionSubheading: {
    fontSize: 12,
    color: COLORS.outline,
    marginTop: 2,
  },
  addMedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLow,
    borderWidth: 1,
    borderColor: COLORS.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 4,
  },
  addMedButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  editAgainButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLow,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
  },
  editAgainText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.primary,
  },
  editableMedicineCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  editableMedCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  medPillIndexBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  medPillIndexText: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  deleteMedButton: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLow,
  },
  inputWrapper: {
    marginBottom: 10,
  },
  inputFieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.outline,
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  textInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  medTextInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.onSurface,
    padding: 0,
  },
  editIconBadge: {
    marginLeft: 8,
    padding: 4,
    backgroundColor: '#e0e7ff',
    borderRadius: 6,
  },
  confirmActionButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 12,
    marginBottom: 20,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmActionButtonDisabled: {
    opacity: 0.7,
  },
  buttonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 0.3,
  },
  medicineCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  medCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  medIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: COLORS.surfaceLow,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  medTitleContainer: {
    flex: 1,
  },
  medTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  medInstructions: {
    fontSize: 12,
    color: COLORS.outline,
    marginTop: 2,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    backgroundColor: COLORS.surfaceLow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
  },
  scheduleBadgeContainer: {
    marginTop: 8,
    marginBottom: 10,
    gap: 6,
  },
  scheduleMainPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'flex-start',
    gap: 6,
  },
  scheduleMainText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3730a3',
  },
  slotChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  timeSlotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
  },
  slotEmoji: {
    fontSize: 11,
  },
  timeSlotText: {
    fontSize: 11,
    fontWeight: '600',
  },
  slotMorning: {
    backgroundColor: '#fef3c7',
    borderWidth: 0.5,
    borderColor: '#fde68a',
  },
  slotMorningText: {
    color: '#92400e',
  },
  slotAfternoon: {
    backgroundColor: '#ffedd5',
    borderWidth: 0.5,
    borderColor: '#fed7aa',
  },
  slotAfternoonText: {
    color: '#c2410c',
  },
  slotNight: {
    backgroundColor: '#ede9fe',
    borderWidth: 0.5,
    borderColor: '#ddd6fe',
  },
  slotNightText: {
    color: '#6b21a8',
  },
  noMedCard: {
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  noMedText: {
    marginLeft: 12,
    fontSize: 13,
    color: COLORS.outline,
    flex: 1,
  },
  rawTextAccordion: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  accordionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  accordionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginLeft: 8,
  },
  accordionBody: {
    padding: 16,
    paddingTop: 0,
    backgroundColor: COLORS.surfaceLow,
  },
  rawMonospaceText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: COLORS.onSurfaceVariant,
    lineHeight: 18,
  },
  sectionTitleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  emptySubtext: {
    fontSize: 13,
    color: COLORS.outline,
    fontStyle: 'italic',
  },
  adviceCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#fef3c7',
    shadowColor: '#d97706',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  adviceCardHeader: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#92400e',
    letterSpacing: 1.2,
  },
  adviceList: {
    gap: 8,
  },
  adviceItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  adviceText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#78350f',
    lineHeight: 18,
  },
  adviceEmptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adviceEmptyText: {
    fontSize: 13,
    color: COLORS.outline,
    fontStyle: 'italic',
  },
  footerMetaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  fullAnalysisNavButton: {
    backgroundColor: COLORS.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  fullAnalysisNavText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginRight: 8,
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
  // Utilities Styles
  uploadUtilityCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  uploadUtilityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  uploadActiveLangTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,103,126,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  uploadActiveLangText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  uploadTtsLangSelector: {
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  uploadTtsLangHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  uploadTtsLangLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  uploadTtsLangToggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  uploadTtsLangBtn: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  uploadTtsLangBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  uploadTtsLangBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  uploadTtsLangBtnTextActive: {
    color: '#ffffff',
  },
  uploadTtsLangBtnSub: {
    fontSize: 9,
    fontWeight: '500',
    color: COLORS.outline,
    marginTop: 1,
  },
  uploadTtsLangBtnSubActive: {
    color: 'rgba(255,255,255,0.85)',
  },
  uploadUtilityTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: COLORS.outline,
    letterSpacing: 1.2,
    marginBottom: 0,
  },
  uploadUtilityGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  uploadUtilBtn: {
    flex: 1,
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  uploadUtilBtnActive: {
    backgroundColor: '#eff6ff',
    borderColor: COLORS.primary,
  },
  uploadUtilBtnSuccess: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  uploadUtilIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,103,126,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  uploadUtilIconCircleActive: {
    backgroundColor: COLORS.primary,
  },
  uploadUtilIconCircleSuccess: {
    backgroundColor: '#059669',
  },
  uploadUtilBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  uploadUtilBtnTextActive: {
    color: COLORS.primary,
  },
  uploadUtilBtnTextSuccess: {
    color: '#065f46',
  },
  ttsSpeakerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,103,126,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    marginLeft: 6,
  },
  ttsSpeakerButtonActive: {
    backgroundColor: COLORS.primary,
  },
  ttsSpeakerText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
  },
  ttsSpeakerTextActive: {
    color: '#ffffff',
  },
  uploadExportPdfButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.secondary,
    paddingVertical: 15,
    borderRadius: 16,
    marginTop: 12,
    marginBottom: 20,
    shadowColor: COLORS.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  uploadExportPdfButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});