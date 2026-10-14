import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { API_BASE_URL } from '../constants/config';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';

function formatDate(dateStr) {
  if (!dateStr) return 'RECENT';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'RECENT';
    const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month} ${day}, ${year}`;
  } catch {
    return 'RECENT';
  }
}

export default function DashboardScreen({ navigation }) {
  const { user } = useAuth();
  const displayName = user?.name ? user.name.split(' ')[0] : 'User';

  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPrescriptions = useCallback(async (isPullToRefresh = false) => {
    try {
      if (isPullToRefresh) {
        setRefreshing(true);
      }
      const response = await fetch(`${API_BASE_URL}/prescriptions`);
      if (response.ok) {
        const data = await response.json();
        setPrescriptions(Array.isArray(data) ? data : []);
      } else {
        console.warn(`Prescriptions fetch returned status: ${response.status}`);
      }
    } catch (err) {
      console.error("Error fetching prescriptions on dashboard:", err);
    } finally {
      setLoading(false);
      if (isPullToRefresh) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchPrescriptions();
    const unsubscribe = navigation.addListener('focus', () => {
      fetchPrescriptions();
    });
    return unsubscribe;
  }, [navigation, fetchPrescriptions]);

  const recentScans = prescriptions.slice(0, 3);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={() => fetchPrescriptions(true)}
            colors={[COLORS.primary]}
            tintColor={COLORS.primary}
          />
        }
      >
        
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greetingHeader}>INTELLIGENT HEALTH ASSISTANT</Text>
            <Text style={styles.greeting}>Hello, <Text style={styles.greetingName}>{displayName}</Text></Text>
          </View>

          <TouchableOpacity 
            style={styles.profileImageContainer}
            onPress={() => navigation.navigate('Profile')}
          >
             <MaterialIcons name="person" size={24} color={COLORS.primary} />
          </TouchableOpacity>
        </View>

        <Text style={styles.subtitle}>Your medical analysis is updated. Upload a new prescription or review your clinical history below.</Text>

        {/* Upload Card */}
        <TouchableOpacity 
          style={styles.uploadCard} 
          onPress={() => navigation.navigate('Scan')}
          activeOpacity={0.9}
        >
          <View style={styles.uploadCardBg}>
            <View style={styles.badgeContainer}>
              <View style={styles.badgeDot} />
              <Text style={styles.badgeText}>AI VISION ACTIVE</Text>
            </View>
            <Text style={styles.uploadTitle}>Upload{"\n"}Prescription</Text>
            
            <View style={styles.uploadButton}>
              <Text style={styles.uploadButtonText}>Start Scanning</Text>
              <MaterialIcons name="arrow-forward" size={16} color={COLORS.primary} />
            </View>
          </View>
          <MaterialIcons name="add-a-photo" size={140} color="rgba(255,255,255,0.1)" style={styles.bgIcon} />
        </TouchableOpacity>

        {/* Recent Analysis Section Header */}
        <View style={styles.historySection}>
           <Text style={styles.sectionTitle}>Recent Analysis</Text>
           <TouchableOpacity onPress={() => navigation.navigate('Records')}>
             <Text style={styles.seeAllText}>SEE ALL ({prescriptions.length})</Text>
           </TouchableOpacity>
        </View>

        {loading && prescriptions.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.loadingText}>Loading recent records...</Text>
          </View>
        ) : recentScans.length === 0 ? (
          /* Empty State */
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconWrap}>
              <MaterialIcons name="description" size={36} color={COLORS.outline} />
            </View>
            <Text style={styles.emptyTitle}>No prescriptions scanned yet</Text>
            <Text style={styles.emptySubtitle}>
              Upload or scan a prescription above to digitize medications and detect safety alerts.
            </Text>
            <TouchableOpacity 
              style={styles.emptyScanBtn}
              onPress={() => navigation.navigate('Scan')}
            >
              <MaterialIcons name="add-a-photo" size={16} color="#fff" />
              <Text style={styles.emptyScanBtnText}>Scan Now</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Real Recent Scans */
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentCardsScroll}>
            {recentScans.map((item, index) => {
              const meds = item.medicines || item.extracted_data?.medicines || [];
              const firstMed = meds[0] || {};
              const drugTitle = firstMed.drug_name || firstMed.name || firstMed.drug || (item.patient_name ? `Rx: ${item.patient_name}` : `Prescription #${item.id}`);
              const strengthText = firstMed.strength ? ` ${firstMed.strength}` : '';
              const extraCount = meds.length > 1 ? ` (+${meds.length - 1} more)` : '';
              const formBadge = firstMed.form || (item.is_owner ? 'Personal' : 'External');
              const isVerified = item.extracted_data?.verification?.license_status === 'Valid' || item.extracted_data?.doctor_license_validated;
              const dateText = formatDate(item.date_scanned || item.created_at);

              return (
                <TouchableOpacity 
                  key={item.id || index}
                  style={styles.recentCard} 
                  activeOpacity={0.8} 
                  onPress={() => navigation.navigate('PrescriptionDetails', { data: item.extracted_data || item, id: item.id })}
                >
                   <View style={styles.recentCardImagePlaceholder}>
                      <MaterialIcons 
                        name={formBadge.toLowerCase().includes('inj') ? 'vaccines' : formBadge.toLowerCase().includes('syp') ? 'water-drop' : 'medication'} 
                        size={40} 
                        color={COLORS.primary} 
                      />
                      <View style={styles.pillBadge}>
                        <Text style={styles.pillBadgeText}>{formBadge}</Text>
                      </View>
                   </View>
                   <View style={styles.recentCardInfo}>
                     <Text style={styles.dateText}>{dateText}</Text>
                     <Text style={styles.medicineText} numberOfLines={1}>
                       {drugTitle}{strengthText}{extraCount}
                     </Text>
                     <View style={styles.verifiedRow}>
                       <MaterialIcons 
                         name={isVerified ? "verified" : "check-circle"} 
                         size={14} 
                         color={isVerified ? COLORS.secondary : COLORS.outline} 
                       />
                       <Text style={styles.verifiedText}>
                         {isVerified ? "Doctor Verified" : "AI Digitized"}
                       </Text>
                     </View>
                   </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
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
  scrollContent: {
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  greetingHeader: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.outline,
    letterSpacing: 2,
    marginBottom: 4,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '300',
    color: COLORS.onSurface,
  },
  greetingName: {
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  profileImageContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceHigh,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0,212,255,0.2)',
  },
  subtitle: {
    fontSize: 15,
    color: COLORS.onSurfaceVariant,
    lineHeight: 22,
    marginBottom: 28,
  },
  uploadCard: {
    backgroundColor: COLORS.primary,
    borderRadius: 32,
    overflow: 'hidden',
    marginBottom: 32,
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 8,
  },
  uploadCardBg: {
    padding: 24,
    minHeight: 220,
    justifyContent: 'space-between',
  },
  bgIcon: {
    position: 'absolute',
    right: -20,
    top: -20,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.secondaryFixed,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 1,
  },
  uploadTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 20,
    marginBottom: 20,
  },
  uploadButton: {
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
  },
  uploadButtonText: {
    color: COLORS.primary,
    fontWeight: 'bold',
    marginRight: 8,
  },
  historySection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.onSurface,
  },
  seeAllText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: COLORS.primary,
    letterSpacing: 0.5,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  loadingText: {
    marginLeft: 10,
    fontSize: 13,
    color: COLORS.onSurfaceVariant,
  },
  emptyCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.surfaceLow,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.onSurface,
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: COLORS.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 16,
    paddingHorizontal: 12,
  },
  emptyScanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  emptyScanBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: 'bold',
    marginLeft: 6,
  },
  recentCardsScroll: {
    marginHorizontal: -24,
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  recentCard: {
    width: 240,
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    marginRight: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.surfaceHigh,
  },
  recentCardImagePlaceholder: {
    height: 110,
    backgroundColor: COLORS.surfaceLow,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillBadge: {
    position: 'absolute',
    bottom: 10,
    left: 12,
    backgroundColor: 'rgba(0,103,126,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: COLORS.primary,
  },
  recentCardInfo: {
    padding: 16,
  },
  dateText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.outline,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  medicineText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: COLORS.onSurface,
    marginBottom: 8,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  verifiedText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.onSurfaceVariant,
    marginLeft: 4,
  }
});
