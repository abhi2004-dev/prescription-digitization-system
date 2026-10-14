import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

const COMMON_CONDITIONS = [
  'Hypertension',
  'Type 2 Diabetes',
  'Asthma',
  'High Cholesterol',
  'Allergies',
  'Acid Reflux',
  'Thyroid Disorder',
  'None',
];

const COMMON_MEDICATIONS = [
  'Metformin',
  'Lisinopril',
  'Atorvastatin',
  'Amlodipine',
  'Omeprazole',
  'Albuterol',
  'Levothyroxine',
  'None',
];

export default function OnboardingScreen({ navigation }) {
  const { saveProfile } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  // Selected arrays
  const [conditions, setConditions] = useState([]);
  const [medications, setMedications] = useState([]);

  // Custom input states
  const [customCondition, setCustomCondition] = useState('');
  const [customMedication, setCustomMedication] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const toggleCondition = (item) => {
    if (item === 'None') {
      setConditions(conditions.includes('None') ? [] : ['None']);
      return;
    }
    const filtered = conditions.filter((c) => c !== 'None');
    if (filtered.includes(item)) {
      setConditions(filtered.filter((c) => c !== item));
    } else {
      setConditions([...filtered, item]);
    }
  };

  const addCustomCondition = () => {
    const trimmed = customCondition.trim();
    if (!trimmed) return;
    const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
    const newItems = parts.filter((p) => !conditions.includes(p));
    if (newItems.length > 0) {
      setConditions((prev) => [...prev.filter((c) => c !== 'None'), ...newItems]);
    }
    setCustomCondition('');
  };

  const removeCondition = (item) => {
    setConditions(conditions.filter((c) => c !== item));
  };

  const toggleMedication = (item) => {
    if (item === 'None') {
      setMedications(medications.includes('None') ? [] : ['None']);
      return;
    }
    const filtered = medications.filter((m) => m !== 'None');
    if (filtered.includes(item)) {
      setMedications(filtered.filter((m) => m !== item));
    } else {
      setMedications([...filtered, item]);
    }
  };

  const addCustomMedication = () => {
    const trimmed = customMedication.trim();
    if (!trimmed) return;
    const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
    const newItems = parts.filter((p) => !medications.includes(p));
    if (newItems.length > 0) {
      setMedications((prev) => [...prev.filter((m) => m !== 'None'), ...newItems]);
    }
    setCustomMedication('');
  };

  const removeMedication = (item) => {
    setMedications(medications.filter((m) => m !== item));
  };

  const handleSubmit = async () => {
    setErrorMessage('');

    if (!name.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    if (!email.trim()) {
      setErrorMessage('Please enter your email address.');
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setLoading(true);

    // If there's uncommitted custom text in inputs, include it
    let finalConditions = [...conditions];
    if (customCondition.trim()) {
      const parts = customCondition.split(',').map((p) => p.trim()).filter(Boolean);
      finalConditions = [...finalConditions.filter((c) => c !== 'None'), ...parts];
    }

    let finalMedications = [...medications];
    if (customMedication.trim()) {
      const parts = customMedication.split(',').map((p) => p.trim()).filter(Boolean);
      finalMedications = [...finalMedications.filter((m) => m !== 'None'), ...parts];
    }

    const payload = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      current_conditions: finalConditions,
      active_medications: finalMedications,
    };

    const result = await saveProfile(payload);
    setLoading(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Failed to save profile. Please check your network connection.');
      Alert.alert('Connection Error', result.error || 'Failed to save profile. Please try again.');
    }
    // Note: When saveProfile succeeds, AuthContext updates `user`,
    // which causes the root Navigator in AppNavigator to immediately switch to MainStack/Dashboard.
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.brandBadge}>
              <MaterialIcons name="health-and-safety" size={18} color={COLORS.primary} />
              <Text style={styles.brandBadgeText}>PATIENT PROFILE SETUP</Text>
            </View>
            <Text style={styles.title}>Welcome to PrescriptoAI</Text>
            <Text style={styles.subtitle}>
              Set up your personal medical profile to enable personalized drug interaction checks and clinical digitization.
            </Text>
          </View>

          {errorMessage ? (
            <View style={styles.errorBanner}>
              <MaterialIcons name="error-outline" size={18} color="#ba1a1a" />
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Personal Information Section */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>
              <MaterialIcons name="person" size={18} color={COLORS.primary} /> Personal Details
            </Text>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name *</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons name="badge" size={20} color={COLORS.outline} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Alexander Fleming"
                  placeholderTextColor={COLORS.outlineVariant}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email Address *</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons name="email" size={20} color={COLORS.outline} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. alexander@example.com"
                  placeholderTextColor={COLORS.outlineVariant}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Phone Number</Text>
              <View style={styles.inputContainer}>
                <MaterialIcons name="phone" size={20} color={COLORS.outline} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. +1 (555) 234-5678"
                  placeholderTextColor={COLORS.outlineVariant}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </View>
            </View>
          </View>

          {/* Current Medical Conditions Section */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>
              <MaterialIcons name="healing" size={18} color={COLORS.primary} /> Medical Conditions
            </Text>
            <Text style={styles.sectionSubtitle}>
              Select any chronic conditions or allergies, or enter them below.
            </Text>

            {/* Chips Container */}
            <View style={styles.chipsContainer}>
              {COMMON_CONDITIONS.map((cond) => {
                const isSelected = conditions.includes(cond);
                return (
                  <TouchableOpacity
                    key={cond}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() => toggleCondition(cond)}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={isSelected ? 'check-circle' : 'add-circle-outline'}
                      size={16}
                      color={isSelected ? COLORS.onPrimary : COLORS.primary}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {cond}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Custom Condition Adder */}
            <View style={styles.customAddRow}>
              <TextInput
                style={styles.customInput}
                placeholder="Add other conditions (comma-separated)..."
                placeholderTextColor={COLORS.outlineVariant}
                value={customCondition}
                onChangeText={setCustomCondition}
                onSubmitEditing={addCustomCondition}
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.addButton} onPress={addCustomCondition}>
                <MaterialIcons name="add" size={20} color={COLORS.onPrimary} />
              </TouchableOpacity>
            </View>

            {/* Selected Tags Display */}
            {conditions.length > 0 && (
              <View style={styles.selectedTagsContainer}>
                <Text style={styles.selectedTagsLabel}>Selected Conditions:</Text>
                <View style={styles.chipsContainer}>
                  {conditions.map((c) => (
                    <View key={c} style={styles.activeTag}>
                      <Text style={styles.activeTagText}>{c}</Text>
                      <TouchableOpacity onPress={() => removeCondition(c)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="close" size={16} color={COLORS.primary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* Active Medications Section */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>
              <MaterialIcons name="medication" size={18} color={COLORS.primary} /> Active Medications
            </Text>
            <Text style={styles.sectionSubtitle}>
              Select any medications you currently take for AI interaction detection.
            </Text>

            {/* Chips Container */}
            <View style={styles.chipsContainer}>
              {COMMON_MEDICATIONS.map((med) => {
                const isSelected = medications.includes(med);
                return (
                  <TouchableOpacity
                    key={med}
                    style={[styles.chip, isSelected && styles.chipSelected]}
                    onPress={() => toggleMedication(med)}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={isSelected ? 'check-circle' : 'add-circle-outline'}
                      size={16}
                      color={isSelected ? COLORS.onPrimary : COLORS.primary}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                      {med}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Custom Medication Adder */}
            <View style={styles.customAddRow}>
              <TextInput
                style={styles.customInput}
                placeholder="Add other medications (comma-separated)..."
                placeholderTextColor={COLORS.outlineVariant}
                value={customMedication}
                onChangeText={setCustomMedication}
                onSubmitEditing={addCustomMedication}
                returnKeyType="done"
              />
              <TouchableOpacity style={styles.addButton} onPress={addCustomMedication}>
                <MaterialIcons name="add" size={20} color={COLORS.onPrimary} />
              </TouchableOpacity>
            </View>

            {/* Selected Medications Display */}
            {medications.length > 0 && (
              <View style={styles.selectedTagsContainer}>
                <Text style={styles.selectedTagsLabel}>Selected Medications:</Text>
                <View style={styles.chipsContainer}>
                  {medications.map((m) => (
                    <View key={m} style={styles.activeTag}>
                      <Text style={styles.activeTagText}>{m}</Text>
                      <TouchableOpacity onPress={() => removeMedication(m)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <MaterialIcons name="close" size={16} color={COLORS.primary} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[styles.submitButton, loading && styles.submitButtonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.onPrimary} size="small" />
            ) : (
              <>
                <Text style={styles.submitButtonText}>Complete Setup & Continue</Text>
                <MaterialIcons name="arrow-forward" size={20} color={COLORS.onPrimary} />
              </>
            )}
          </TouchableOpacity>

          {/* Login Back Option */}
          <TouchableOpacity
            style={styles.backOption}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.backOptionText}>Already registered? <Text style={styles.backOptionLink}>Back to Login</Text></Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,103,126,0.1)',
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 10,
  },
  brandBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
    marginLeft: 6,
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 6,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.onSurfaceVariant,
    lineHeight: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffdad6',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorBannerText: {
    color: '#ba1a1a',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: COLORS.onSurfaceVariant,
    marginBottom: 14,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
    marginBottom: 6,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: COLORS.onSurface,
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLow,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: 13,
    color: COLORS.onSurface,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: COLORS.onPrimary,
    fontWeight: '600',
  },
  customAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  customInput: {
    flex: 1,
    backgroundColor: COLORS.surfaceLow,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 44,
    fontSize: 13,
    color: COLORS.onSurface,
  },
  addButton: {
    backgroundColor: COLORS.primary,
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedTagsContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.surfaceHigh,
  },
  selectedTagsLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.outline,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  activeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,103,126,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    gap: 6,
  },
  activeTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
    gap: 8,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    color: COLORS.onPrimary,
    fontSize: 16,
    fontWeight: 'bold',
  },
  backOption: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  backOptionText: {
    fontSize: 14,
    color: COLORS.onSurfaceVariant,
  },
  backOptionLink: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
});
