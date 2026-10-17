import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '../constants/config';
import { addMedicationToProfile as serviceAddMedication } from '../services/profileService';

export const USER_STORAGE_KEY = '@user_session';
export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  /**
   * Fetches the user profile from the backend.
   * If the API call fails (network error, parse error, 500, etc.),
   * it retains the cached user from state/AsyncStorage and NEVER sets user to null.
   * It only sets user to null if a strict 401 Unauthorized is returned.
   */
  const fetchProfile = async () => {
    try {
      setAuthError(null);

      const response = await fetch(`${API_BASE_URL}/user/profile`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      // Strict 401 Unauthorized: user session expired or invalid
      if (response.status === 401) {
        console.warn('[AuthContext] Received 401 Unauthorized from /user/profile. Logging out.');
        setUser(null);
        await AsyncStorage.removeItem(USER_STORAGE_KEY);
        return null;
      }

      if (response.ok) {
        const data = await response.json();
        if (data && (data.id || data.name)) {
          setUser(data);
          try {
            await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data));
          } catch (storageErr) {
            console.warn('[AuthContext] Failed to cache user to AsyncStorage:', storageErr);
          }
          return data;
        }
      } else {
        // Non-200 and non-401 response (e.g. 500 server error, 404, 503)
        console.error(`[AuthContext] /user/profile returned status ${response.status}. Retaining cached user state.`);
        // Fallback to AsyncStorage if state user is null
        const cachedStr = await AsyncStorage.getItem(USER_STORAGE_KEY);
        if (cachedStr) {
          try {
            const cachedUser = JSON.parse(cachedStr);
            if (cachedUser) setUser((prev) => prev || cachedUser);
          } catch (e) {}
        }
      }
    } catch (err) {
      // Network failure, timeout, offline, JSON parse error
      console.error('[AuthContext] Network or parse error fetching user profile:', err);
      setAuthError(err.message);
      // Retain the cached user state from AsyncStorage - NEVER set user to null on network error!
      try {
        const cachedStr = await AsyncStorage.getItem(USER_STORAGE_KEY);
        if (cachedStr) {
          const cachedUser = JSON.parse(cachedStr);
          if (cachedUser) setUser((prev) => prev || cachedUser);
        }
      } catch (storageErr) {
        console.error('[AuthContext] Failed reading cached user from AsyncStorage:', storageErr);
      }
    }
  };

  /**
   * Auto-Login on App Launch:
   * Reads the user object/token from AsyncStorage and hydrates the user state
   * BEFORE hiding the splash screen (setLoading(false)).
   */
  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        setLoading(true);

        // 1. Read cached user from AsyncStorage and hydrate state immediately
        const cachedUserStr = await AsyncStorage.getItem(USER_STORAGE_KEY);
        if (cachedUserStr) {
          try {
            const cachedUser = JSON.parse(cachedUserStr);
            if (cachedUser && (cachedUser.id || cachedUser.name || cachedUser.email)) {
              if (isMounted) {
                setUser(cachedUser);
              }
            }
          } catch (parseErr) {
            console.warn('[AuthContext] Failed to parse cached user on startup:', parseErr);
          }
        }

        // 2. Refresh/verify user profile from API in background
        await fetchProfile();
      } catch (initErr) {
        console.error('[AuthContext] Error during initialization:', initErr);
      } finally {
        if (isMounted) {
          // Splash screen is hidden ONLY after hydration & check are done
          setLoading(false);
        }
      }
    };

    initializeAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const saveProfile = async (profileData) => {
    try {
      setAuthError(null);
      const response = await fetch(`${API_BASE_URL}/user/profile`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(profileData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Failed to save profile (${response.status})`);
      }

      const savedUser = await response.json();
      setUser(savedUser);
      await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(savedUser));
      return { success: true, user: savedUser };
    } catch (err) {
      console.error('Error saving user profile:', err);
      setAuthError(err.message);
      // Fallback: save locally so user can continue working offline
      if (profileData && profileData.name) {
        const localUser = { id: 1, ...profileData };
        setUser(localUser);
        try {
          await AsyncStorage.setItem(USER_STORAGE_KEY, JSON.stringify(localUser));
        } catch (e) {}
        return { success: true, user: localUser };
      }
      return { success: false, error: err.message };
    }
  };

  const logout = async () => {
    try {
      setUser(null);
      await AsyncStorage.removeItem(USER_STORAGE_KEY);
    } catch (err) {
      console.error('[AuthContext] Error during logout:', err);
      setUser(null);
    }
  };

  const addMedicationToProfile = async (matchedDrugData) => {
    return await serviceAddMedication(matchedDrugData, user, setUser);
  };

  const value = {
    user,
    loading,
    authError,
    setUser,
    saveProfile,
    addMedicationToProfile,
    logout,
    refreshProfile: fetchProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
