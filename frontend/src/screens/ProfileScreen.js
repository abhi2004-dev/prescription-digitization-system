import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS } from '../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSavedUserAlarms } from '../services/alarmStorage';
import { ACTIVE_MEDICATIONS_KEY } from '../services/profileService';

export default function ProfileScreen({ navigation }) {
  const { user, logout, refreshProfile } = useAuth();
  const [cachedUser, setCachedUser] = useState(null);
  const [savedAlarms, setSavedAlarms] = useState([]);
  const [loadingAlarms, setLoadingAlarms] = useState(false);
  const [asyncMedications, setAsyncMedications] = useState([]);

  // Load cached user session if context user is temporarily incomplete
  const loadCachedProfile = async () => {
    try {
      const raw = await AsyncStorage.getItem('@user_session');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          setCachedUser(parsed);
        }
      }
    } catch (err) {
      console.warn('Error reading @user_session in ProfileScreen:', err);
    }
  };

  const profileUser = user || cachedUser || {};

  // Defensive helper function: checks if med is a string (return med) or an object (return med.drug_name)
  const getMedicationName = (med) => {
    if (!med) return '';
    if (typeof med === 'string') return med.trim();
    if (typeof med === 'object') {
      return (med.drug_name || med.name || med.drug || '').trim();
    }
    return String(med).trim();
  };

  const getConditionName = (c) => {
    if (!c) return '';
    if (typeof c === 'string') return c.trim();
    if (typeof c === 'object') {
      return (c.name || c.condition || c.title || c.label || '').trim();
    }
    return String(c).trim();
  };

  const rawConditions = Array.isArray(profileUser?.current_conditions)
    ? profileUser.current_conditions
    : typeof profileUser?.current_conditions === 'string'
      ? profileUser.current_conditions.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(profileUser?.conditions)
        ? profileUser.conditions
        : [];
  const conditions = Array.from(new Set(rawConditions.map(getConditionName).filter(Boolean)));

  const rawServerMeds = Array.isArray(profileUser?.active_medications)
    ? profileUser.active_medications
    : Array.isArray(profileUser?.active_meds)
      ? profileUser.active_meds
      : Array.isArray(profileUser?.medications)
        ? profileUser.medications
        : typeof profileUser?.active_medications === 'string'
          ? profileUser.active_medications.split(',').map((s) => s.trim()).filter(Boolean)
          : [];

  const rawAsyncMeds = Array.isArray(asyncMedications) ? asyncMedications : [];

  const medications = Array.from(
    new Set([...rawServerMeds, ...rawAsyncMeds].map(getMedicationName).filter(Boolean))
  );

  const loadAlarms = async () => {
    try {
      setLoadingAlarms(true);
      const data = await getSavedUserAlarms();
      setSavedAlarms(data || []);
    } catch (err) {
      console.error('Error loading user_alarms in ProfileScreen:', err);
    } finally {
      setLoadingAlarms(false);
    }
  };

  const loadLocalMedications = async () => {
    try {
      const raw = await AsyncStorage.getItem(ACTIVE_MEDICATIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setAsyncMedications(parsed);
        }
      }
    } catch (err) {
      console.warn('Error reading local active medications:', err);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadAlarms();
      loadLocalMedications();
      loadCachedProfile();
      if (typeof refreshProfile === 'function') {
        try {
          const res = refreshProfile();
          if (res && typeof res.catch === 'function') {
            res.catch((err) => {
              console.warn('[ProfileScreen] Silently handled refreshProfile rejection:', err);
            });
          }
        } catch (err) {
          console.warn('[ProfileScreen] Error triggering refreshProfile:', err);
        }
      }
    }, [])
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Patient Account</Text>
        </View>

        {/* Profile Info Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <MaterialIcons name="person" size={40} color={COLORS.primary} />
          </View>
          <View style={styles.infoContainer}>
            <Text style={styles.name}>{profileUser?.name || 'Registered Patient'}</Text>
            <Text style={styles.email}>{profileUser?.email || 'patient@example.com'}</Text>
            {profileUser?.phone ? (
              <Text style={styles.phone}>{profileUser.phone}</Text>
            ) : null}
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>Active Profile</Text>
            </View>
          </View>
        </View>

        {/* Clinical Summary Section */}
        <Text style={styles.sectionTitle}>Medical Profile</Text>
        <View style={styles.clinicalCard}>
          <View style={styles.clinicalHeader}>
            <View style={styles.clinicalHeaderLeft}>
              <MaterialIcons name="healing" size={20} color={COLORS.primary} />
              <Text style={styles.clinicalHeaderTitle}>Current Conditions</Text>
            </View>
            <TouchableOpacity onPress={() => navigation.navigate('EditProfile')}>
              <Text style={styles.editText}>EDIT</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.chipsRow}>
            {conditions.length > 0 ? (
              conditions.map((c, i) => (
                <View key={`cond-chip-${i}`} style={styles.conditionChip}>
                  <Text style={styles.conditionChipText}>{getConditionName(c)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>No conditions specified</Text>
            )}
          </View>

          <View style={[styles.clinicalHeader, { marginTop: 16 }]}>
            <View style={styles.clinicalHeaderLeft}>
              <MaterialIcons name="medication" size={20} color={COLORS.secondary} />
              <Text style={styles.clinicalHeaderTitle}>Active Medications</Text>
            </View>
          </View>
          <View style={styles.chipsRow}>
            {medications.length > 0 ? (
              medications.map((med, i) => (
                <View key={`med-chip-${i}`} style={styles.medicationChip}>
                  <Text style={styles.medicationChipText}>{getMedicationName(med)}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>No active medications recorded</Text>
            )}
          </View>
        </View>

        {/* Active Medication Alarms Section (Action 3 - Read-Only) */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Active Medication Alarms</Text>
          <View style={styles.alarmCountBadge}>
            <Text style={styles.alarmCountText}>
              {(Array.isArray(savedAlarms) ? savedAlarms : []).reduce(
                (acc, m) =>
                  acc + (Array.isArray(m?.alarms) ? m.alarms.filter((a) => a && a.enabled).length : 0),
                0
              )}{' '}
              SCHEDULED
            </Text>
          </View>
        </View>

        <View style={styles.alarmsCard}>
          {loadingAlarms ? (
            <View style={styles.alarmsLoadingContainer}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          ) : Array.isArray(savedAlarms) && savedAlarms.length > 0 ? (
            savedAlarms.map((item, idx) => {
              if (!item) return null;
              const activeSlots = Array.isArray(item.alarms)
                ? item.alarms.filter((a) => a && a.enabled)
                : [];
              const medNameDisplay = typeof item.medication === 'object'
                ? getMedicationName(item.medication)
                : String(item.medication || 'Medication');
              return (
                <View key={`prof-alarm-${idx}`} style={styles.alarmMedBlock}>
                  <View style={styles.alarmMedHeader}>
                    <View style={styles.alarmMedHeaderLeft}>
                      <View style={styles.alarmIconCircle}>
                        <MaterialIcons name="alarm" size={16} color={COLORS.primary} />
                      </View>
                      <Text style={styles.alarmMedName}>
                        {medNameDisplay}
                        {item.strength ? ` (${String(item.strength)})` : ''}
                      </Text>
                    </View>
                    <View style={styles.activeSlotsCountPill}>
                      <Text style={styles.activeSlotsCountText}>
                        {activeSlots.length} active
                      </Text>
                    </View>
                  </View>

                  <View style={styles.alarmSlotsGrid}>
                    {activeSlots.length > 0 ? (
                      activeSlots.map((slot, sIdx) => (
                        <View key={`prof-slot-${sIdx}`} style={styles.alarmSlotBadge}>
                          <Text style={styles.alarmSlotEmoji}>{String(slot?.emoji || '⏰')}</Text>
                          <View style={styles.alarmSlotTextCol}>
                            <Text style={styles.alarmSlotLabel}>{String(slot?.label || '')}</Text>
                            <Text style={styles.alarmSlotTime}>{String(slot?.time || '')}</Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.noSlotsText}>No active slots configured</Text>
                    )}
                  </View>

                  {idx < savedAlarms.length - 1 && <View style={styles.alarmDivider} />}
                </View>
              );
            })
          ) : (
            <View style={styles.emptyAlarmsContainer}>
              <View style={styles.emptyAlarmIconCircle}>
                <MaterialIcons name="alarm-off" size={24} color={COLORS.outline} />
              </View>
              <Text style={styles.emptyAlarmsTitle}>No Active Medication Reminders</Text>
              <Text style={styles.emptyAlarmsSubtitle}>
                Reminders configured in the Prescription Details screen will automatically appear here.
              </Text>
            </View>
          )}
        </View>

        {/* Settings Sections */}
        <Text style={styles.sectionTitle}>Preferences & Setup</Text>
        <View style={styles.menuContainer}>
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => navigation.navigate('EditProfile')}
          >
            <View style={styles.menuItemLeft}>
              <MaterialIcons name="edit" size={22} color={COLORS.primary} />
              <Text style={styles.menuItemText}>Update Medical Profile</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={COLORS.outlineVariant} />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <MaterialIcons name="security" size={22} color={COLORS.outline} />
              <Text style={styles.menuItemText}>Privacy & Security</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={COLORS.outlineVariant} />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.menuItem}>
            <View style={styles.menuItemLeft}>
              <MaterialIcons name="info" size={22} color={COLORS.outline} />
              <Text style={styles.menuItemText}>About PrescriptoAI</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color={COLORS.outlineVariant} />
          </TouchableOpacity>
        </View>

        {/* Logout Button */}
        <TouchableOpacity 
           style={styles.logoutButton}
           onPress={logout}
           activeOpacity={0.85}
        >
          <MaterialIcons name="logout" size={20} color="#ba1a1a" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>

      </ScrollView>
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
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  profileCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  avatarContainer: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: COLORS.surfaceHigh,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,103,126,0.2)',
    marginRight: 16,
  },
  infoContainer: {
    flex: 1,
  },
  name: {
    fontSize: 19,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 2,
  },
  email: {
    fontSize: 13,
    color: COLORS.onSurfaceVariant,
    marginBottom: 2,
  },
  phone: {
    fontSize: 13,
    color: COLORS.outline,
    marginBottom: 6,
  },
  statusBadge: {
    backgroundColor: 'rgba(0,103,126,0.1)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.primary,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: COLORS.onSurfaceVariant,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  clinicalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  clinicalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  clinicalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clinicalHeaderTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.onSurface,
    marginLeft: 8,
  },
  editText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  conditionChip: {
    backgroundColor: 'rgba(0,103,126,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  conditionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  medicationChip: {
    backgroundColor: 'rgba(0,107,92,0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  medicationChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.secondary,
  },
  emptyText: {
    fontSize: 13,
    color: COLORS.outline,
    fontStyle: 'italic',
  },
  menuContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 1,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuItemText: {
    fontSize: 15,
    color: COLORS.onSurface,
    marginLeft: 12,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.surfaceHigh,
    marginLeft: 50,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffdad6',
    padding: 16,
    borderRadius: 16,
    marginTop: 8,
  },
  logoutText: {
    marginLeft: 8,
    fontSize: 15,
    fontWeight: 'bold',
    color: '#ba1a1a',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  alarmCountBadge: {
    backgroundColor: 'rgba(0,103,126,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  alarmCountText: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  alarmsCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  alarmsLoadingContainer: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alarmMedBlock: {
    paddingVertical: 4,
  },
  alarmMedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  alarmMedHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  alarmIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,103,126,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  alarmMedName: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.onSurface,
    flexShrink: 1,
  },
  activeSlotsCountPill: {
    backgroundColor: 'rgba(0,107,92,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  activeSlotsCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.secondary,
  },
  alarmSlotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
    marginBottom: 4,
  },
  alarmSlotBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceHigh,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,103,126,0.15)',
  },
  alarmSlotEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  alarmSlotTextCol: {
    flexDirection: 'column',
  },
  alarmSlotLabel: {
    fontSize: 10,
    color: COLORS.onSurfaceVariant,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  alarmSlotTime: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.onSurface,
  },
  noSlotsText: {
    fontSize: 12,
    color: COLORS.outline,
    fontStyle: 'italic',
    paddingVertical: 4,
  },
  alarmDivider: {
    height: 1,
    backgroundColor: COLORS.surfaceHigh,
    marginVertical: 12,
  },
  emptyAlarmsContainer: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAlarmIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  emptyAlarmsTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.onSurfaceVariant,
    marginBottom: 4,
  },
  emptyAlarmsSubtitle: {
    fontSize: 12,
    color: COLORS.outline,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 16,
  },
});
