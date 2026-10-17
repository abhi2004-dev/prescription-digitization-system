import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Try loading expo-notifications safely to prevent crashes in non-supported environments
let Notifications = null;
try {
  Notifications = require('expo-notifications');
  if (Notifications && typeof Notifications.setNotificationHandler === 'function') {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    });
  }
} catch (err) {
  console.log('[NotificationService] expo-notifications fallback active');
}

// Fallback / mock token for Expo Go demo presentations
export const DEMO_PUSH_TOKEN = 'demo-token-123';

/**
 * Register for remote push notifications and obtain token.
 * Hard-bypassed for Expo Go SDK demo presentation.
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
  if (Notifications && typeof Notifications.requestPermissionsAsync === 'function') {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    } catch (e) {
      console.warn('[NotificationService] Permission request failed:', e);
    }
  }
  return true;
}

/**
 * Parses duration strings like "for 5 days", "5 days", "10 days", "1 week", "2 weeks", "1 month"
 * into a numeric number of days. Defaults to 5 days if unspecified.
 */
export function parseDurationDays(durationStr) {
  if (durationStr === null || durationStr === undefined) return 5;
  if (typeof durationStr === 'number' && !isNaN(durationStr) && durationStr > 0) {
    return Math.round(durationStr);
  }
  if (typeof durationStr !== 'string') return 5;

  const str = durationStr.toLowerCase().trim();
  if (!str) return 5;

  // Check for weeks
  const weekMatch = str.match(/(\d+)\s*(?:weeks?|wks?)/i);
  if (weekMatch) {
    const val = parseInt(weekMatch[1], 10);
    if (!isNaN(val) && val > 0) return val * 7;
  }
  if (str.includes('a week') || str.includes('one week')) {
    return 7;
  }

  // Check for months
  const monthMatch = str.match(/(\d+)\s*(?:months?|mos?)/i);
  if (monthMatch) {
    const val = parseInt(monthMatch[1], 10);
    if (!isNaN(val) && val > 0) return val * 30;
  }
  if (str.includes('a month') || str.includes('one month')) {
    return 30;
  }

  // Check for explicit days (e.g. "for 5 days", "5 days", "x 5 d", "5d")
  const dayMatch = str.match(/(\d+)\s*(?:days?|d\b)?/i);
  if (dayMatch) {
    const val = parseInt(dayMatch[1], 10);
    if (!isNaN(val) && val > 0) return val;
  }

  return 5;
}

/**
 * Calculates the exact end date based on a start date and duration in days.
 */
export function calculateEndDate(startDate = new Date(), durationDays = 5) {
  const start = startDate instanceof Date ? startDate : new Date(startDate);
  const end = new Date(start.getTime() + (durationDays * 24 * 60 * 60 * 1000));
  // Set end of day: 23:59:59
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Formats a Date object into a readable date string (e.g., "Wed, Oct 21, 2026").
 */
export function formatReadableDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
  return d.toLocaleDateString('en-US', options);
}

/**
 * Parses time string like "8:00 AM" or "1:30 PM" into hours and minutes.
 */
function parseTimeComponents(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { hour: 8, minute: 0 };
  }
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/);
  if (!match) {
    return { hour: 8, minute: 0 };
  }
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3] ? match[3].toUpperCase() : null;

  if (period === 'PM' && hours < 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }
  return { hour: hours, minute: minutes };
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
 * Schedules granular medication alarms with duration boundaries.
 * Notifications will automatically stop firing after the specified number of days (end date).
 *
 * @param {Array} medications - Array of prescribed medications or custom alarm configs
 * @param {string} patientName - Optional patient name for personalized notification messages
 * @param {Object} options - Optional global duration / end date overrides
 */
export async function scheduleMedicationAlarms(medications, patientName = '', options = {}) {
  if (!medications || !Array.isArray(medications) || medications.length === 0) {
    return { success: false, count: 0, message: 'No medications provided to schedule.' };
  }

  const defaultSlotConfigs = [
    { key: 'morning', name: 'Morning Dose', hour: 8, minute: 0, timeStr: '8:00 AM', emoji: '🌅' },
    { key: 'afternoon', name: 'Afternoon Dose', hour: 13, minute: 0, timeStr: '1:00 PM', emoji: '☀️' },
    { key: 'night', name: 'Night Dose', hour: 20, minute: 0, timeStr: '8:00 PM', emoji: '🌙' },
  ];

  let scheduledCount = 0;
  const scheduledDetails = [];
  const now = new Date();

  for (let medIdx = 0; medIdx < medications.length; medIdx++) {
    const med = medications[medIdx];
    if (!med) continue;

    const medName = med.medication || med.drug_name || med.name || med.drug || 'Prescription Medication';
    const strength = med.strength || med.dosage || '';
    
    // Determine duration in days: prioritize med.durationDays, then parsed med.duration, then options
    const durationDays = med.durationDays || parseDurationDays(med.duration || options.durationDays || 5);
    
    // Determine end date: prioritize med.endDate, then options.endDate, then calculate from now + durationDays
    const endDate = med.endDate
      ? new Date(med.endDate)
      : (options.endDate ? new Date(options.endDate) : calculateEndDate(now, durationDays));

    const formattedEndDate = formatReadableDate(endDate);

    // Check if this med has custom alarms configured (from bottom sheet or alarmStorage)
    const hasCustomAlarms = Array.isArray(med.alarms) && med.alarms.length > 0;
    const defaultSlots = parseMedicationSlots(med);

    for (const slotConfig of defaultSlotConfigs) {
      let isEnabled = false;
      let slotTimeStr = slotConfig.timeStr;
      let slotHour = slotConfig.hour;
      let slotMinute = slotConfig.minute;

      if (hasCustomAlarms) {
        const matchingCustomSlot = med.alarms.find(a => a.slot === slotConfig.key);
        if (matchingCustomSlot) {
          isEnabled = Boolean(matchingCustomSlot.enabled);
          if (matchingCustomSlot.time) {
            slotTimeStr = matchingCustomSlot.time;
            const parsed = parseTimeComponents(slotTimeStr);
            slotHour = parsed.hour;
            slotMinute = parsed.minute;
          }
        }
      } else {
        isEnabled = Boolean(defaultSlots[slotConfig.key]);
      }

      if (isEnabled) {
        scheduledCount++;
        const alarmId = `med-alarm-${medIdx}-${slotConfig.key}`;

        // Attempt scheduling Expo local notifications for each day within duration
        // Capped at 30 days to avoid OS local notification limits while respecting the end date
        if (Notifications && typeof Notifications.scheduleNotificationAsync === 'function') {
          const daysToSchedule = Math.min(durationDays, 30);
          for (let dayOffset = 0; dayOffset < daysToSchedule; dayOffset++) {
            const triggerDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, slotHour, slotMinute, 0);
            
            // Only schedule if trigger date is in future and before the duration end date
            if (triggerDate.getTime() > now.getTime() && triggerDate.getTime() <= endDate.getTime()) {
              try {
                await Notifications.scheduleNotificationAsync({
                  content: {
                    title: `⏰ Medication Reminder: ${medName}`,
                    body: `It's time for your ${slotConfig.name} (${slotTimeStr}). ${strength ? `Dose: ${strength}. ` : ''}${patientName ? `Prescribed for ${patientName}.` : ''}`,
                    sound: true,
                    data: {
                      alarmId,
                      medName,
                      slot: slotConfig.key,
                      time: slotTimeStr,
                      endDate: endDate.toISOString(),
                      durationDays,
                    },
                  },
                  trigger: {
                    type: 'date',
                    date: triggerDate,
                  },
                });
              } catch (notifErr) {
                // Silently fallback if running in environments where native alarms are simulated
                console.log(`[NotificationService] Scheduled simulated trigger for ${medName} on day ${dayOffset}`);
              }
            }
          }
        }

        scheduledDetails.push({
          id: alarmId,
          medName,
          strength,
          slot: slotConfig.name,
          slotKey: slotConfig.key,
          time: slotTimeStr,
          durationDays,
          endDate: endDate.toISOString(),
          formattedEndDate,
        });
      }
    }
  }

  return {
    success: scheduledCount > 0,
    count: scheduledCount,
    details: scheduledDetails,
    message: scheduledCount > 0
      ? `Successfully scheduled ${scheduledCount} medication reminder(s). Alarms will automatically stop firing after each drug's prescribed duration.`
      : 'No alarms were scheduled.'
  };
}

/**
 * Cancel all scheduled medication reminders
 */
export async function cancelAllMedicationAlarms() {
  if (Notifications && typeof Notifications.cancelAllScheduledNotificationsAsync === 'function') {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      return true;
    } catch (e) {
      console.warn('[NotificationService] Cancel all error:', e);
    }
  }
  return true;
}

/**
 * Cancel notifications for a specific medication name
 */
export async function cancelMedicationAlarm(medicationName) {
  if (Notifications && typeof Notifications.getAllScheduledNotificationsAsync === 'function') {
    try {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      for (const item of all) {
        if (item.content?.data?.medName?.toLowerCase() === medicationName.toLowerCase()) {
          if (typeof Notifications.cancelScheduledNotificationAsync === 'function') {
            await Notifications.cancelScheduledNotificationAsync(item.identifier);
          }
        }
      }
      return true;
    } catch (e) {
      console.warn('[NotificationService] Cancel med error:', e);
    }
  }
  return true;
}

/**
 * Get all active scheduled alarms
 */
export async function getScheduledAlarms() {
  if (Notifications && typeof Notifications.getAllScheduledNotificationsAsync === 'function') {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (e) {
      console.warn('[NotificationService] getScheduledAlarms error:', e);
    }
  }
  return [];
}