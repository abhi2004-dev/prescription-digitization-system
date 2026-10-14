import * as Speech from 'expo-speech';
import { Alert, Platform } from 'react-native';

/**
 * Regional language definitions for MediScan Text-to-Speech
 * Maps language code to BCP-47 language tag and UI metadata
 */
export const TTS_LANGUAGES = [
  {
    code: 'en',
    label: 'English',
    nativeLabel: 'English',
    bcp47: 'en-IN',
    defaultVoiceRate: 0.95,
  },
  {
    code: 'hi',
    label: 'Hindi',
    nativeLabel: 'हिंदी',
    bcp47: 'hi-IN',
    defaultVoiceRate: 0.9,
  },
  {
    code: 'kn',
    label: 'Kannada',
    nativeLabel: 'ಕನ್ನಡ',
    bcp47: 'kn-IN',
    defaultVoiceRate: 0.88,
  },
];

/**
 * Resolves configuration for a given language code (e.g. 'en', 'hi', 'kn')
 */
export function getLanguageConfig(code = 'en') {
  if (!code) return TTS_LANGUAGES[0];
  const clean = String(code).toLowerCase().slice(0, 2);
  const found = TTS_LANGUAGES.find((lang) => lang.code === clean);
  return found || TTS_LANGUAGES[0];
}

/**
 * Returns the BCP-47 tag based on the language selection:
 * - Hindi: 'hi-IN'
 * - Kannada: 'kn-IN'
 * - English: 'en-IN'
 */
export function getBcp47Tag(code = 'en') {
  return getLanguageConfig(code).bcp47;
}

/**
 * Translates clinical frequency strings into natural, human-readable phrases
 * right before speech synthesis.
 *
 * Patterns:
 * - "1-0-0" -> "take one in the morning"
 * - "0-1-0" -> "take one in the afternoon"
 * - "0-0-1" -> "take one at night"
 * - "1-0-1" -> "take one in the morning and one at night"
 * - "1-1-1" -> "take one in the morning, one in the afternoon, and one at night"
 * - "1-1-0" -> "take one in the morning and one in the afternoon"
 * - "0-1-1" -> "take one in the afternoon and one at night"
 */
export function formatForSpeech(text) {
  if (!text || typeof text !== 'string') return '';

  return text
    .replace(/\b1\s*-\s*1\s*-\s*1\b/g, 'take one in the morning, one in the afternoon, and one at night')
    .replace(/\b1\s*-\s*0\s*-\s*1\b/g, 'take one in the morning and one at night')
    .replace(/\b1\s*-\s*1\s*-\s*0\b/g, 'take one in the morning and one in the afternoon')
    .replace(/\b0\s*-\s*1\s*-\s*1\b/g, 'take one in the afternoon and one at night')
    .replace(/\b1\s*-\s*0\s*-\s*0\b/g, 'take one in the morning')
    .replace(/\b0\s*-\s*1\s*-\s*0\b/g, 'take one in the afternoon')
    .replace(/\b0\s*-\s*0\s*-\s*1\b/g, 'take one at night');
}

/**
 * Converts shorthand medical abbreviations to spoken words
 */
function expandMedicalAbbreviations(text) {
  if (!text) return '';
  return text
    .replace(/(\d+)\s*mg\b/gi, '$1 milligrams')
    .replace(/\bmg\b/gi, 'milligrams')
    .replace(/(\d+)\s*gm?\b/gi, '$1 grams')
    .replace(/\bgm?\b/gi, 'grams')
    .replace(/(\d+)\s*ml\b/gi, '$1 milliliters')
    .replace(/\bml\b/gi, 'milliliters')
    .replace(/\btab\b/gi, 'tablet')
    .replace(/\bcaps?\b/gi, 'capsule')
    .replace(/\bsyr\b/gi, 'syrup')
    .replace(/\bod\b/gi, 'once daily')
    .replace(/\bbd\b|\bbid\b/gi, 'twice daily')
    .replace(/\btds\b|\btid\b/gi, 'thrice daily')
    .replace(/\bqid\b/gi, 'four times daily')
    .replace(/\bhs\b/gi, 'at bedtime');
}

/**
 * Builds a natural language sentence for a single medication.
 */
export function buildMedicationSpeechText(med) {
  if (!med) return 'No medication details available.';

  const drugName = med.drug_name || med.name || med.drug || 'Medication';
  const strength = med.strength || med.dosage || '';
  const form = med.form || 'tablet';
  const frequency = med.frequency || med.schedule_text || med.schedule || 'as directed';
  const instructions = med.instructions || med.timing || '';
  const duration = med.duration ? `for ${med.duration}` : '';

  let speech = `Take ${strength ? strength + ' ' : ''}${form} of ${drugName}`;
  
  if (frequency) {
    speech += `, ${frequency}`;
  }
  if (instructions && instructions.toLowerCase() !== 'as directed by physician') {
    speech += `, ${instructions}`;
  }
  if (duration) {
    speech += `, ${duration}`;
  }
  speech += '.';

  return expandMedicalAbbreviations(speech);
}

/**
 * Builds a full natural language readout for an entire prescription.
 */
export function buildFullPrescriptionSpeechText(data) {
  if (!data) return 'Prescription details not available.';

  const patientName = data.patient_name || data.patient_details?.name;
  const doctorName = data.doctor_name;
  const medicines = data.medicines || data.prescribed_medications || [];
  const validMedicines = medicines.filter(m => m && (m.drug_name || m.name || m.drug));

  let speech = '';

  if (patientName) {
    speech += `Prescription for patient ${patientName}. `;
  } else {
    speech += `Digital Medical Prescription. `;
  }

  if (doctorName) {
    speech += `Prescribed by Doctor ${doctorName.replace(/^dr\.?\s*/i, '')}. `;
  }

  if (validMedicines.length === 0) {
    speech += 'No specific medications were extracted.';
    return speech;
  }

  speech += `There ${validMedicines.length === 1 ? 'is 1 medication' : `are ${validMedicines.length} medications`} prescribed. `;

  validMedicines.forEach((med, idx) => {
    const medSpeech = buildMedicationSpeechText(med);
    speech += `Medication ${idx + 1}: ${medSpeech} `;
  });

  const advice = data.doctor_suggestions || data.doctor_advice || data.advice || [];
  if (advice && advice.length > 0) {
    speech += `Doctor's Advice: ${advice.join('. ')}.`;
  }

  return speech;
}

/**
 * Offline clinical phrase dictionary for fallback translation
 * Ensures essential medical instructions can be vocalized even without network connectivity
 */
const CLINICAL_TRANSLATIONS = {
  hi: [
    [/\btake one in the morning, one in the afternoon, and one at night\b/gi, 'सुबह एक, दोपहर में एक और रात में एक लें'],
    [/\btake one in the morning and one at night\b/gi, 'सुबह एक और रात में एक लें'],
    [/\btake one in the morning and one in the afternoon\b/gi, 'सुबह एक और दोपहर में एक लें'],
    [/\btake one in the afternoon and one at night\b/gi, 'दोपहर में एक और रात में एक लें'],
    [/\btake one in the morning\b/gi, 'सुबह एक लें'],
    [/\btake one in the afternoon\b/gi, 'दोपहर में एक लें'],
    [/\btake one at night\b/gi, 'रात में एक लें'],
    [/\bonce daily\b/gi, 'दिन में एक बार'],
    [/\btwice daily\b/gi, 'दिन में दो बार'],
    [/\bthrice daily\b/gi, 'दिन में तीन बार'],
    [/\bfour times daily\b/gi, 'दिन में चार बार'],
    [/\bat bedtime\b/gi, 'सोते समय'],
    [/\bafter food\b|\bafter meals\b/gi, 'भोजन के बाद'],
    [/\bbefore food\b|\bbefore meals\b/gi, 'भोजन से पहले'],
    [/\bwith food\b/gi, 'भोजन के साथ'],
    [/\bas directed by physician\b|\bas directed\b/gi, 'डॉक्टर के निर्देशानुसार'],
    [/\bmilligrams?\b/gi, 'मिलीग्राम'],
    [/\bgrams?\b/gi, 'ग्राम'],
    [/\bmilliliters?\b/gi, 'मिलीलीटर'],
    [/\btablets?\b/gi, 'गोली'],
    [/\bcapsules?\b/gi, 'कैप्सूल'],
    [/\bsyrups?\b/gi, 'सिरप'],
    [/\bPrescription for patient\b/gi, 'रोगी के लिए नुस्खा'],
    [/\bDigital Medical Prescription\b/gi, 'डिजिटल मेडिकल पर्चा'],
    [/\bPrescribed by Doctor\b/gi, 'डॉक्टर द्वारा निर्धारित'],
    [/\bDoctor's Advice\b/gi, 'डॉक्टर की सलाह'],
    [/\bMedication\b/gi, 'दवा'],
    [/\bfor (\d+) days\b/gi, '$1 दिनों के लिए'],
  ],
  kn: [
    [/\btake one in the morning, one in the afternoon, and one at night\b/gi, 'ಬೆಳಿಗ್ಗೆ ಒಂದು, ಮಧ್ಯಾಹ್ನ ಒಂದು ಮತ್ತು ರಾತ್ರಿ ಒಂದು ತೆಗೆದುಕೊಳ್ಳಿ'],
    [/\btake one in the morning and one at night\b/gi, 'ಬೆಳಿಗ್ಗೆ ಒಂದು ಮತ್ತು ರಾತ್ರಿ ಒಂದು ತೆಗೆದುಕೊಳ್ಳಿ'],
    [/\btake one in the morning and one in the afternoon\b/gi, 'ಬೆಳಿಗ್ಗೆ ಒಂದು ಮತ್ತು ಮಧ್ಯಾಹ್ನ ಒಂದು ತೆಗೆದುಕೊಳ್ಳಿ'],
    [/\btake one in the afternoon and one at night\b/gi, 'ಮಧ್ಯಾಹ್ನ ಒಂದು ಮತ್ತು ರಾತ್ರಿ ಒಂದು ತೆಗೆದುಕೊಳ್ಳಿ'],
    [/\btake one in the morning\b/gi, 'ಬೆಳಿಗ್ಗೆ ಒಂದನ್ನು ತೆಗೆದುಕೊಳ್ಳಿ'],
    [/\btake one in the afternoon\b/gi, 'ಮಧ್ಯಾಹ್ನ ಒಂದನ್ನು ತೆಗೆದುಕೊಳ್ಳಿ'],
    [/\btake one at night\b/gi, 'ರಾತ್ರಿ ಒಂದನ್ನು ತೆಗೆದುಕೊಳ್ಳಿ'],
    [/\bonce daily\b/gi, 'ದಿನಕ್ಕೆ ಒಮ್ಮೆ'],
    [/\btwice daily\b/gi, 'ದಿನಕ್ಕೆ ಎರಡು ಬಾರಿ'],
    [/\bthrice daily\b/gi, 'ದಿನಕ್ಕೆ ಮೂರು ಬಾರಿ'],
    [/\bfour times daily\b/gi, 'ದಿನಕ್ಕೆ ನಾಲ್ಕು ಬಾರಿ'],
    [/\bat bedtime\b/gi, 'ಮಲಗುವ ಮುನ್ನ'],
    [/\bafter food\b|\bafter meals\b/gi, 'ಊಟದ ನಂತರ'],
    [/\bbefore food\b|\bbefore meals\b/gi, 'ಊಟಕ್ಕೆ ಮುಂಚೆ'],
    [/\bwith food\b/gi, 'ಆಹಾರದೊಂದಿಗೆ'],
    [/\bas directed by physician\b|\bas directed\b/gi, 'ವೈದ್ಯರ ನಿರ್ದೇಶನದಂತೆ'],
    [/\bmilligrams?\b/gi, 'ಮಿಲಿಗ್ರಾಂ'],
    [/\bgrams?\b/gi, 'ಗ್ರಾಂ'],
    [/\bmilliliters?\b/gi, 'ಮಿಲಿಲೀಟರ್'],
    [/\btablets?\b/gi, 'ಮಾತ್ರೆ'],
    [/\bcapsules?\b/gi, 'ಕ್ಯಾಪ್ಸುಲ್'],
    [/\bsyrups?\b/gi, 'ಸಿರಪ್'],
    [/\bPrescription for patient\b/gi, 'ರೋಗಿಗೆ ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್'],
    [/\bDigital Medical Prescription\b/gi, 'ಡಿಜಿಟಲ್ ವೈದ್ಯಕೀಯ ಪ್ರಿಸ್ಕ್ರಿಪ್ಷನ್'],
    [/\bPrescribed by Doctor\b/gi, 'ವೈದ್ಯರು ಸೂಚಿಸಿದ್ದಾರೆ'],
    [/\bDoctor's Advice\b/gi, 'ವೈದ್ಯರ ಸಲಹೆ'],
    [/\bMedication\b/gi, 'ಔಷಧಿ'],
    [/\bfor (\d+) days\b/gi, '$1 ದಿನಗಳವರೆಗೆ'],
  ],
};

/**
 * Translates the formatted prescription text into the selected regional language.
 * Uses a free Google Translate GTX API endpoint with a timeout, with offline fallback.
 *
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code ('en', 'hi', or 'kn')
 * @returns {Promise<string>} Translated text string
 */
export async function translatePrescriptionText(text, targetLang = 'en') {
  if (!text || typeof text !== 'string') return '';

  const cleanLang = (targetLang || 'en').toLowerCase().slice(0, 2);
  if (cleanLang === 'en') {
    return text;
  }

  // Pre-format clinical frequencies (e.g. 1-0-0 -> take one in the morning)
  const formatted = formatForSpeech(text);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6500);

    const endpoint = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${cleanLang}&dt=t&q=${encodeURIComponent(formatted)}`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        const translated = data[0]
          .map((chunk) => (Array.isArray(chunk) ? chunk[0] : ''))
          .filter(Boolean)
          .join('');
        if (translated && translated.trim().length > 0) {
          return translated.trim();
        }
      }
    }
  } catch (apiError) {
    console.warn(`Translation API request failed for [${cleanLang}], applying clinical fallback:`, apiError?.message || apiError);
  }

  // Fallback: apply clinical phrase substitutions if offline or API error
  let fallbackText = formatted;
  const dict = CLINICAL_TRANSLATIONS[cleanLang];
  if (dict) {
    for (const [pattern, replacement] of dict) {
      fallbackText = fallbackText.replace(pattern, replacement);
    }
  }

  return fallbackText;
}

/**
 * Detects whether an error message relates to missing TTS voice data
 */
export function isVoiceMissingError(error) {
  if (!error) return false;
  const msg = (typeof error === 'string' ? error : error?.message || error?.code || '').toLowerCase();
  return (
    msg.includes('missing') ||
    msg.includes('not supported') ||
    msg.includes('not installed') ||
    msg.includes('lang_missing_data') ||
    msg.includes('lang_not_supported') ||
    msg.includes('not found') ||
    msg.includes('voice') ||
    msg.includes('no voice') ||
    msg.includes('engine')
  );
}

/**
 * Displays a friendly React Native Alert advising the user to download the
 * regional language voice pack in Android Accessibility settings.
 */
export function showVoicePackMissingAlert(languageCode = 'en') {
  const langConfig = getLanguageConfig(languageCode);
  const langName = langConfig.label;
  const bcpTag = langConfig.bcp47;

  Alert.alert(
    'Voice Pack Not Found',
    `The ${langName} (${bcpTag}) Text-to-Speech voice pack is not installed on your Android device.\n\n` +
    `To enable read-aloud in ${langName}:\n` +
    `1. Open Android Settings > Accessibility\n` +
    `2. Select "Text-to-Speech output"\n` +
    `3. Tap the Settings icon beside Preferred Engine (e.g., Speech Services by Google)\n` +
    `4. Tap "Install voice data"\n` +
    `5. Download and install the ${langName} language pack.`,
    [{ text: 'Got It', style: 'default' }]
  );
}

/**
 * Gracefully handles speech playback errors, executes Speech.stop(), and alerts the user
 */
export async function handleVoiceError(error, language = 'en') {
  try {
    await Speech.stop();
  } catch (stopErr) {
    console.warn('Error stopping speech during error handling:', stopErr);
  }

  const clean = (language || 'en').toLowerCase().slice(0, 2);
  const isRegional = clean === 'hi' || clean === 'kn';

  if (isRegional || isVoiceMissingError(error)) {
    showVoicePackMissingAlert(language);
  } else {
    Alert.alert(
      'Audio Playback Error',
      'Unable to play audio. Please ensure Text-to-Speech is enabled in your device settings.',
      [{ text: 'OK', style: 'default' }]
    );
  }
}

/**
 * Reads aloud a single medication using expo-speech with regional language support.
 * Wraps Speech.speak in a try/catch block and dynamically injects the BCP-47 tag.
 *
 * @param {Object|string} med - Medication object or speech string
 * @param {Object} [options] - Options including language ('en', 'hi', 'kn') and callbacks
 */
export async function speakMedication(med, options = {}) {
  const language = options.language || 'en';
  try {
    const isSpeaking = await Speech.isSpeakingAsync();
    if (isSpeaking) {
      await Speech.stop();
    }

    const rawText = typeof med === 'string' ? med : buildMedicationSpeechText(med);
    const formatted = formatForSpeech(rawText);

    // Translate if regional language (Hindi or Kannada) is selected
    const textToSpeak = await translatePrescriptionText(formatted, language);

    const bcp47 = getBcp47Tag(language);
    const langConfig = getLanguageConfig(language);

    Speech.speak(textToSpeak, {
      language: bcp47,
      pitch: options.pitch ?? 1.0,
      rate: options.rate ?? langConfig.defaultVoiceRate,
      onStart: options.onStart,
      onDone: options.onDone,
      onStopped: options.onStopped,
      onError: async (speechError) => {
        console.warn(`Speech.speak onError for medication [${bcp47}]:`, speechError);
        await handleVoiceError(speechError, language);
        if (options.onError) options.onError(speechError);
      },
    });
  } catch (error) {
    console.error(`TTS speakMedication exception caught [${language}]:`, error);
    await handleVoiceError(error, language);
    if (options.onError) options.onError(error);
  }
}

/**
 * Reads aloud the entire prescription with regional language support.
 * Wraps Speech.speak in a try/catch block and dynamically injects the BCP-47 tag.
 *
 * @param {Object|string} data - Prescription data object or text
 * @param {Object} [options] - Options including language ('en', 'hi', 'kn') and callbacks
 */
export async function speakFullPrescription(data, options = {}) {
  const language = options.language || 'en';
  try {
    const isSpeaking = await Speech.isSpeakingAsync();
    if (isSpeaking) {
      await Speech.stop();
    }

    const rawText = typeof data === 'string' ? data : buildFullPrescriptionSpeechText(data);
    const formatted = formatForSpeech(rawText);

    // Translate if regional language (Hindi or Kannada) is selected
    const textToSpeak = await translatePrescriptionText(formatted, language);

    const bcp47 = getBcp47Tag(language);
    const langConfig = getLanguageConfig(language);

    Speech.speak(textToSpeak, {
      language: bcp47,
      pitch: options.pitch ?? 1.0,
      rate: options.rate ?? langConfig.defaultVoiceRate,
      onStart: options.onStart,
      onDone: options.onDone,
      onStopped: options.onStopped,
      onError: async (speechError) => {
        console.warn(`Speech.speak onError for full prescription [${bcp47}]:`, speechError);
        await handleVoiceError(speechError, language);
        if (options.onError) options.onError(speechError);
      },
    });
  } catch (error) {
    console.error(`TTS speakFullPrescription exception caught [${language}]:`, error);
    await handleVoiceError(error, language);
    if (options.onError) options.onError(error);
  }
}

/**
 * Stops any active speech.
 */
export async function stopSpeech() {
  try {
    await Speech.stop();
  } catch (error) {
    console.error('Error stopping speech:', error);
  }
}
