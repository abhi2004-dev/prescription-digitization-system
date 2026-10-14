// frontend/src/constants/config.js

/**
 * Backend base URL configuration.
 * Configured to http://10.109.122.170:8000 to connect directly
 * to the host machine over LAN/hotspot during Expo Go sessions.
 */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.109.122.170:8000';

export default {
  API_BASE_URL,
};

