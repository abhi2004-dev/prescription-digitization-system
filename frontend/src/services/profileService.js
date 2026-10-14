import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../constants/config';

export const ACTIVE_MEDICATIONS_KEY = '@active_medications';

/**
 * Normalizes any matched drug input (string, array of strings, or medication objects)
 * into a clean list of unique medication names.
 *
 * @param {string|string[]|Object|Object[]} matchedDrugData
 * @returns {string[]} List of trimmed medication names
 */
export function extractDrugNames(matchedDrugData) {
  if (!matchedDrugData) return [];

  let list = [];
  if (Array.isArray(matchedDrugData)) {
    list = matchedDrugData.map((item) => {
      if (typeof item === 'string') return item.trim();
      return (item?.drug_name || item?.name || item?.drug || '').trim();
    }).filter(Boolean);
  } else if (typeof matchedDrugData === 'string') {
    list = [matchedDrugData.trim()].filter(Boolean);
  } else if (typeof matchedDrugData === 'object') {
    const name = (matchedDrugData.drug_name || matchedDrugData.name || matchedDrugData.drug || '').trim();
    if (name) list = [name];
  }

  // Deduplicate case-insensitively
  const seen = new Set();
  const unique = [];
  for (const name of list) {
    const lower = name.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(name);
    }
  }

  return unique;
}

/**
 * Automatically saves matched medication(s) to the user's Active Medications profile in the background.
 * Updates both AsyncStorage and the backend profile endpoint silently without blocking the UI.
 *
 * @param {string|string[]|Object|Object[]} matchedDrugData - Medication(s) to add
 * @param {Object} [currentUser] - Optional current user profile object
 * @param {Function} [onProfileUpdated] - Optional callback (e.g. setUser from AuthContext)
 * @returns {Promise<{success: boolean, added: string[], updatedList: string[]}>}
 */
export async function addMedicationToProfile(matchedDrugData, currentUser = null, onProfileUpdated = null) {
  try {
    const drugNamesToAdd = extractDrugNames(matchedDrugData);
    if (drugNamesToAdd.length === 0) {
      return { success: false, added: [], updatedList: [] };
    }

    // 1. Retrieve current active medications from AsyncStorage
    let storedMeds = [];
    try {
      const raw = await AsyncStorage.getItem(ACTIVE_MEDICATIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          storedMeds = parsed;
        }
      }
    } catch (e) {
      console.warn('[ProfileService] Error reading AsyncStorage:', e);
    }

    // Also merge with currentUser.active_medications if available
    const userMeds = Array.isArray(currentUser?.active_medications)
      ? currentUser.active_medications
      : [];

    const existingSet = new Set(
      [...storedMeds, ...userMeds].map((m) => String(m).trim().toLowerCase())
    );

    // Identify which medications are new
    const newMedsToAdd = [];
    for (const drug of drugNamesToAdd) {
      if (!existingSet.has(drug.toLowerCase())) {
        newMedsToAdd.push(drug);
        existingSet.add(drug.toLowerCase());
      }
    }

    // If all matched drugs are already in the profile, we're done
    if (newMedsToAdd.length === 0) {
      const currentList = [...new Set([...storedMeds, ...userMeds])];
      return { success: true, added: [], updatedList: currentList };
    }

    // Combine into updated list
    const combinedList = [...new Set([...storedMeds, ...userMeds, ...newMedsToAdd])];

    // 2. Persist to AsyncStorage silently
    try {
      await AsyncStorage.setItem(ACTIVE_MEDICATIONS_KEY, JSON.stringify(combinedList));
    } catch (storageErr) {
      console.warn('[ProfileService] AsyncStorage setItem warning:', storageErr);
    }

    // 3. Post to backend profile endpoint (/user/profile) silently
    let savedServerUser = null;
    try {
      const payload = {
        name: currentUser?.name || '',
        email: currentUser?.email || '',
        phone: currentUser?.phone || '',
        current_conditions: currentUser?.current_conditions || [],
        active_medications: combinedList,
      };

      const response = await fetch(`${API_BASE_URL}/user/profile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        savedServerUser = await response.json();
      }
    } catch (apiErr) {
      console.warn('[ProfileService] Backend profile sync warning (persisted locally):', apiErr?.message);
    }

    // 4. Silently update AuthContext user state so UI (ProfileScreen, etc.) updates immediately
    const finalUser = savedServerUser || (currentUser ? { ...currentUser, active_medications: combinedList } : { active_medications: combinedList });
    if (typeof onProfileUpdated === 'function') {
      onProfileUpdated(finalUser);
    }

    console.log(`[ProfileService] Background auto-saved ${newMedsToAdd.length} medication(s) to profile:`, newMedsToAdd);
    return { success: true, added: newMedsToAdd, updatedList: combinedList };
  } catch (err) {
    console.warn('[ProfileService] Failed to auto-save medication to profile in background:', err);
    return { success: false, added: [], error: err?.message };
  }
}
