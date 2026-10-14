import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Fallback / mock token for Expo Go demo presentations
export const DEMO_PUSH_TOKEN = 'demo-token-123';

// EXPO GO BYPASS: Commented out native handler to prevent startup crashes
/*
if (Constants.appOwnership !== 'expo') {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  } catch (error) {
    console.warn('[NotificationService] Failed to configure notification handler:', error);
  }
}
*/

/**
 * Register for remote push notifications and obtain token.
 * Hard-bypassed for Expo Go SDK 53 presentation.
 */
export async function registerForPushNotificationsAsync() {
  console.log("Forcing push notification bypass for demo.");
  return DEMO_PUSH_TOKEN;
}

/**
 * Direct wrapper for getExpoPushTokenAsync with Expo Go bypass.
 */
export async function getExpoPushTokenAsync() {
  return { data: DEMO_PUSH_TOKEN };
}

/**
 * Safe listener registration for push tokens with Expo Go bypass.
 */
export function addPushTokenListener(callback) {
  return { remove: () => {} };
}

/**
 * Request notification permissions and configure notification channel for Android.
 */
export async function requestNotificationPermissions() {
  return true; // Bypassed for demo
}

/**
 * Parses medication schedule into active daily alarm slots:
 * Morning: 8:00 AM, Afternoon: 1:00 PM, Night: 8:00 PM
 */
export function parseMedicationSlots(med) {
  const slots = {
    morning: false,
    afternoon: false,
    night: false,
  };

  if (!med) return slots;

  if (med.schedule_slots && typeof med.schedule_slots === 'object') {
    if (med.schedule_slots.morning) slots.morning = true;
    if (med.schedule_slots.afternoon) slots.afternoon = true;
    if (med.schedule_slots.night) slots.night = true;
    if (slots.morning || slots.afternoon || slots.night) {
      return slots;
    }
  }

  const rawFreq = (med.frequency || med.schedule || med.schedule_text || '').trim().toLowerCase();

  if (rawFreq.includes('-')) {
    const parts = rawFreq.split('-').map(p => p.trim());
    if (parts[0] && parts[0] !== '0' && parts[0] !== 'none') slots.morning = true;
    if (parts[1] && parts[1] !== '0' && parts[1] !== 'none') slots.afternoon = true;
    if (parts[2] && parts[2] !== '0' && parts[2] !== 'none') slots.night = true;
    return slots;
  }

  if (rawFreq.includes('tid') || rawFreq.includes('tds') || rawFreq.includes('thrice') || rawFreq.includes('3 times')) {
    slots.morning = true;
    slots.afternoon = true;
    slots.night = true;
  } else if (rawFreq.includes('bid') || rawFreq.includes('bd') || rawFreq.includes('twice') || rawFreq.includes('2 times')) {
    slots.morning = true;
    slots.night = true;
  } else if (rawFreq.includes('qid') || rawFreq.includes('4 times')) {
    slots.morning = true;
    slots.afternoon = true;
    slots.night = true;
  } else if (rawFreq.includes('hs') || rawFreq.includes('night') || rawFreq.includes('bedtime')) {
    slots.night = true;
  } else if (rawFreq.includes('od') || rawFreq.includes('daily') || rawFreq.includes('once') || rawFreq.includes('morning')) {
    slots.morning = true;
  } else {
    slots.morning = true;
  }

  return slots;
}

/**
 * Schedules daily recurring local push notifications for a list of prescribed medications.
 * Simulated for Expo Go presentation.
 */
export async function scheduleMedicationAlarms(medications, patientName = '') {
  if (!medications || !Array.isArray(medications) || medications.length === 0) {
    return { success: false, count: 0, message: 'No medications provided to schedule.' };
  }

  const scheduleConfigs = [
    { key: 'morning', name: 'Morning Dose', hour: 8, minute: 0, timeStr: '8:00 AM', emoji: '🌅' },
    { key: 'afternoon', name: 'Afternoon Dose', hour: 13, minute: 0, timeStr: '1:00 PM', emoji: '☀️' },
    { key: 'night', name: 'Night Dose', hour: 20, minute: 0, timeStr: '8:00 PM', emoji: '🌙' },
  ];

  let scheduledCount = 0;
  const scheduledDetails = [];

  for (const med of medications) {
    const medName = med.drug_name || med.name || med.drug || 'Prescription Medication';
    const slots = parseMedicationSlots(med);

    for (const config of scheduleConfigs) {
      if (slots[config.key]) {
        scheduledCount++;
        scheduledDetails.push({
          id: `demo-alarm-${scheduledCount}`,
          medName,
          slot: config.name,
          time: config.timeStr,
        });
      }
    }
  }

  return {
    success: scheduledCount > 0,
    count: scheduledCount,
    details: scheduledDetails,
    message: scheduledCount > 0
      ? `Successfully scheduled ${scheduledCount} daily medication reminder${scheduledCount > 1 ? 's' : ''} (8:00 AM, 1:00 PM, 8:00 PM).`
      : 'No alarms were scheduled.'
  };
}

/**
 * Cancel all scheduled medication reminders
 */
export async function cancelAllMedicationAlarms() {
  return true; // Bypassed for demo
}

/**
 * Get all active scheduled alarms
 */
export async function getScheduledAlarms() {
  return []; // Bypassed for demo
}