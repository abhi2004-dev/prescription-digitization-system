import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../constants/theme';
import { MaterialIcons } from '@expo/vector-icons';

export default function DashboardScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greetingHeader}>INTELLIGENT HEALTH ASSISTANT</Text>
            <Text style={styles.greeting}>Hello, <Text style={styles.greetingName}>Alexander</Text></Text>
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

        {/* History Card Row */}
        <View style={styles.historySection}>
           <Text style={styles.sectionTitle}>Recent Analysis</Text>
           <TouchableOpacity onPress={() => navigation.navigate('Records')}>
             <Text style={styles.seeAllText}>SEE ALL</Text>
           </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.recentCardsScroll}>
          {/* Recent Card 1 */}
          <TouchableOpacity style={styles.recentCard} activeOpacity={0.8} onPress={() => navigation.navigate('PrescriptionDetails', { id: 1 })}>
             <View style={styles.recentCardImagePlaceholder}>
                <MaterialIcons name="medication" size={40} color={COLORS.outlineVariant} />
                <View style={styles.pillBadge}><Text style={styles.pillBadgeText}>Antibiotic</Text></View>
             </View>
             <View style={styles.recentCardInfo}>
               <Text style={styles.dateText}>OCT 12, 2023</Text>
               <Text style={styles.medicineText}>Amoxicillin 500mg</Text>
               <View style={styles.verifiedRow}>
                 <MaterialIcons name="check-circle" size={14} color={COLORS.secondary} />
                 <Text style={styles.verifiedText}>AI Verified</Text>
               </View>
             </View>
          </TouchableOpacity>

          {/* Recent Card 2 */}
          <TouchableOpacity style={styles.recentCard} activeOpacity={0.8} onPress={() => navigation.navigate('PrescriptionDetails', { id: 2 })}>
             <View style={styles.recentCardImagePlaceholder}>
                <MaterialIcons name="healing" size={40} color={COLORS.outlineVariant} />
                <View style={[styles.pillBadge, { backgroundColor: COLORS.primaryContainer }]}><Text style={[styles.pillBadgeText, {color: COLORS.onPrimary}]}>Blood Pressure</Text></View>
             </View>
             <View style={styles.recentCardInfo}>
               <Text style={styles.dateText}>OCT 05, 2023</Text>
               <Text style={styles.medicineText}>Lisinopril 10mg</Text>
               <View style={styles.verifiedRow}>
                 <MaterialIcons name="check-circle" size={14} color={COLORS.secondary} />
                 <Text style={styles.verifiedText}>AI Verified</Text>
               </View>
             </View>
          </TouchableOpacity>
        </ScrollView>

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
    fontSize: 16,
    color: COLORS.onSurfaceVariant,
    lineHeight: 24,
    marginBottom: 32,
  },
  uploadCard: {
    backgroundColor: COLORS.primary, // gradient fallback
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
  },
  recentCardImagePlaceholder: {
    height: 120,
    backgroundColor: COLORS.surfaceLow,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pillBadge: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    backgroundColor: COLORS.secondaryFixed,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  pillBadgeText: {
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#00201a',
  },
  recentCardInfo: {
    padding: 16,
  },
  dateText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: COLORS.outline,
    marginBottom: 4,
  },
  medicineText: {
    fontSize: 16,
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
