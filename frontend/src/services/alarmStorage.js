import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseMedicationSlots } from './notificationService';

export const USER_ALARMS_STORAGE_KEY = 'user_alarms';

export const DEFAULT_ALARM_TIMES = {
  morning: '8:00 AM',
  afternoon: '1:00 PM',
  night: '8:00 PM',
};

/**
 * Converts a 12-hour time string like "8:00 AM" or "1:30 PM" to a JavaScript Date object.
 */
export function parseTimeStringToDate(timeStr) {
  const date = new Date();
  if (!timeStr || typeof timeStr !== 'string') {
    date.setHours(8, 0, 0, 0);
    return date;
  }
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?$/);
  if (!match) {
    date.setHours(8, 0, 0, 0);
    return date;
  }
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3] ? match[3].toUpperCase() : null;

  if (period === 'PM' && hours < 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Formats a JavaScript Date object into a readable 12-hour string (e.g., "11:00 PM").
 */
export function formatTime12Hour(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return '8:00 AM';
  }
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const formattedMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hours}:${formattedMinutes} ${period}`;
}

/**
 * Builds initial alarm configurations for a medication using parsed schedule slots.
 */
export function buildInitialMedicationAlarms(med) {
  const slots = parseMedicationSlots(med);
  const medName = med.drug_name || med.name || med.drug || 'Medication';
  const strength = med.strength || med.dosage || '';

  return {
    medication: medName,
    strength,
    alarms: [
      {
        slot: 'morning',
        label: 'Morning',
        time: DEFAULT_ALARM_TIMES.morning,
        enabled: Boolean(slots.morning),
        emoji: '🌅',
      },
      {
        slot: 'afternoon',
        label: 'Afternoon',
        time: DEFAULT_ALARM_TIMES.afternoon,
        enabled: Boolean(slots.afternoon),
        emoji: '☀️',
      },
      {
        slot: 'night',
        label: 'Night',
        time: DEFAULT_ALARM_TIMES.night,
        enabled: Boolean(slots.night),
        emoji: '🌙',
      },
    ],
  };
}

/**
 * Loads all saved user alarms from AsyncStorage.
 */
export async function getSavedUserAlarms() {
  try {
    const raw = await AsyncStorage.getItem(USER_ALARMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[alarmStorage] Error loading user_alarms:', error);
    return [];
  }
}

/**
 * Saves or updates configured alarms for a list of medications in AsyncStorage.
 */
export async function saveUserAlarms(newAlarmsList) {
  try {
    const existing = await getSavedUserAlarms();
    const alarmMap = new Map();

    // Index existing by lowercase med name
    existing.forEach((item) => {
      if (item && item.medication) {
        alarmMap.set(item.medication.trim().toLowerCase(), item);
      }
    });

    // Merge or overwrite with new configs
    newAlarmsList.forEach((item) => {
      if (item && item.medication) {
        alarmMap.set(item.medication.trim().toLowerCase(), {
          ...item,
          updatedAt: new Date().toISOString(),
        });
      }
    });

    const merged = Array.from(alarmMap.values());
    await AsyncStorage.setItem(USER_ALARMS_STORAGE_KEY, JSON.stringify(merged));
    return { success: true, alarms: merged };
  } catch (error) {
    console.error('[alarmStorage] Error saving user_alarms:', error);
    return { success: false, error };
  }
}

/**
 * Clears an alarm for a specific medication.
 */
export async function deleteUserAlarm(medicationName) {
  try {
    const existing = await getSavedUserAlarms();
    const filtered = existing.filter(
      (item) => (item.medication || '').trim().toLowerCase() !== medicationName.trim().toLowerCase()
    );
    await AsyncStorage.setItem(USER_ALARMS_STORAGE_KEY, JSON.stringify(filtered));
    return { success: true, alarms: filtered };
  } catch (error) {
    console.error('[alarmStorage] Error deleting user alarm:', error);
    return { success: false, error };
  }
}
