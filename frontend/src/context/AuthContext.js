import React, { createContext, useState, useEffect, useContext } from 'react';
import { API_BASE_URL } from '../constants/config';

import { addMedicationToProfile as serviceAddMedication } from '../services/profileService';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      setAuthError(null);

      // Try primary API endpoint
      const response = await fetch(`${API_BASE_URL}/user/profile`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.id && data.name) {
          setUser(data);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (err) {
      console.log('Error loading user profile on startup:', err.message);
      setUser(null);
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
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
      return { success: true, user: savedUser };
    } catch (err) {
      console.error('Error saving user profile:', err);
      setAuthError(err.message);
      return { success: false, error: err.message };
    }
  };

  const logout = () => {
    setUser(null);
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
