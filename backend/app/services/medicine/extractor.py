"""
Medicine Extractor — Person 3's Module
=======================================
Takes raw OCR text and extracts structured medicine information.
Uses fuzzy matching against a known medicine list to handle OCR misspellings.
"""
import re
import difflib

# ─── Known medicine names (common prescriptions) ──────────────────────
KNOWN_MEDICINES = [
    "Amoxicillin", "Augmentin", "Azithromycin", "Aspirin",
    "Atenolol", "Atorvastatin", "Amlodipine", "Albuterol",
    "Acetaminophen", "Alprazolam",
    "Benadryl", "Bisoprolol",
    "Cetirizine", "Ciprofloxacin", "Clopidogrel", "Cephalexin",
    "Cough Syrup", "Clarithromycin", "Clindamycin",
    "Diclofenac", "Doxycycline", "Diazepam", "Domperidone",
    "Enalapril", "Escitalopram", "Erythromycin",
    "Fluoxetine", "Furosemide", "Fexofenadine",
    "Gabapentin", "Glimepiride", "Gliclazide",
    "Hydrochlorothiazide", "Hydroxychloroquine",
    "Ibuprofen", "Insulin",
    "Ketoconazole",
    "Lisinopril", "Losartan", "Levofloxacin", "Levothyroxine",
    "Lorazepam", "Loperamide", "Lansoprazole",
    "Metformin", "Metoprolol", "Montelukast", "Metronidazole",
    "Meloxicam", "Methylprednisolone",
    "Naproxen", "Nifedipine", "Nitrofurantoin",
    "Omeprazole", "Ondansetron", "Ofloxacin",
    "Paracetamol", "Pantoprazole", "Prednisone", "Prednisolone",
    "Propranolol", "Pregabalin",
    "Ramipril", "Ranitidine", "Rosuvastatin",
    "Sertraline", "Simvastatin", "Spironolactone", "Salbutamol",
    "Tamsulosin", "Telmisartan", "Tramadol",
    "Valsartan", "Venlafaxine", "Verapamil",
    "Warfarin",
    "Xylometazoline",
    "Zolpidem",
]

# Pre-compute lowercase versions for matching
_MEDICINE_LOWER = {m.lower(): m for m in KNOWN_MEDICINES}

# ─── Frequency keywords ──────────────────────────────────────────────
FREQUENCY_PATTERNS = [
    (r'\b(?:once\s+)?(?:daily|a\s+day|per\s+day|od)\b', 'once daily'),
    (r'\b(?:twice|2\s*x|bd|bid)\s*(?:daily|a\s+day|per\s+day)?\b', 'twice daily'),
    (r'\b(?:thrice|3\s*x|tds|tid)\s*(?:daily|a\s+day|per\s+day)?\b', 'thrice daily'),
    (r'\b(?:4\s*x|qid|qds)\s*(?:daily|a\s+day)?\b', '4 times daily'),
    (r'\bat\s*(?:bed\s*time|night|hs)\b', 'at night'),
    (r'\b(?:before|ac)\s*(?:meals?|food|breakfast|lunch|dinner)\b', 'before meals'),
    (r'\b(?:after|pc)\s*(?:meals?|food|breakfast|lunch|dinner)\b', 'after meals'),
    (r'\b(?:every|q)\s*(\d+)\s*(?:hr|hour)s?\b', 'every \\1 hours'),
    (r'\b(?:morning|am)\b', 'morning'),
    (r'\b(?:evening|pm)\b', 'evening'),
    (r'\b(?:sos|as\s+needed|prn)\b', 'as needed'),
]

# ─── Dosage pattern ───────────────────────────────────────────────────
DOSAGE_PATTERN = re.compile(
    r'(\d+(?:\.\d+)?)\s*'             # number
    r'(mg|mcg|g|ml|iu|units?|tabs?|'  # unit
    r'capsules?|cap|caps|'
    r'tsp|tbsp|drops?|puffs?|'
    r'sachets?|vials?|'
    r'tablets?|tab)',
    re.IGNORECASE
)

# ─── Words to skip (not medicines) ───────────────────────────────────
SKIP_WORDS = {
    'dr', 'doctor', 'mr', 'mrs', 'ms', 'patient', 'age', 'sex',
    'male', 'female', 'date', 'rx', 'diagnosis', 'sig', 'disp',
    'refill', 'phone', 'tel', 'fax', 'clinic', 'hospital',
    'address', 'registration', 'license', 'signature', 'md',
    'mbbs', 'internal', 'medicine', 'general', 'physician',
    'surgeon', 'take', 'apply', 'inject', 'use', 'rub',
}


def _clean_line(line):
    """Remove noise artifacts like '0 0' padding from OCR output."""
    # Remove leading/trailing '0' or '0 0' artifacts
    line = re.sub(r'^[\s0]+\s+', '', line)
    line = re.sub(r'\s+[\s0]+$', '', line)
    # Remove stray single digits at start/end
    line = re.sub(r'^\d\s+', '', line)
    line = re.sub(r'\s+\d$', '', line)
    return line.strip()


def _is_skip_line(line):
    """Check if a line is likely NOT a medicine line (doctor info, patient info, etc.)."""
    lower = line.lower()
    # Skip lines with doctor/patient info patterns
    if re.search(r'\b(dr\.?|doctor|patient|age\s*:|sex\s*:|date\s*:|phone|tel|\+91|mbbs|md\s)', lower):
        return True
    # Skip lines that are mostly numbers (phone, dates, IDs)
    digits = sum(c.isdigit() for c in line)
    if len(line) > 3 and digits / len(line) > 0.6:
        return True
    # Skip very short lines with no alpha
    alpha = sum(c.isalpha() for c in line)
    if alpha < 3:
        return True
    return False


def _fuzzy_match_medicine(word):
    """
    Try to match a word against known medicine names using fuzzy matching.
    Returns (matched_name, confidence_score) or (None, 0).
    """
    word_lower = word.lower().strip()
    if len(word_lower) < 3:
        return None, 0

    # Exact match
    if word_lower in _MEDICINE_LOWER:
        return _MEDICINE_LOWER[word_lower], 1.0

    # Fuzzy match
    matches = difflib.get_close_matches(word_lower, _MEDICINE_LOWER.keys(), n=1, cutoff=0.6)
    if matches:
        score = difflib.SequenceMatcher(None, word_lower, matches[0]).ratio()
        return _MEDICINE_LOWER[matches[0]], score

    return None, 0


def _extract_dosage(text):
    """Extract dosage from text (e.g., '500mg', '10 ml')."""
    match = DOSAGE_PATTERN.search(text)
    if match:
        return match.group(0).strip()
    return ""


def _extract_frequency(text):
    """Extract frequency/timing from text."""
    lower = text.lower()
    for pattern, replacement in FREQUENCY_PATTERNS:
        match = re.search(pattern, lower)
        if match:
            # Handle group references in replacement
            if '\\1' in replacement and match.groups():
                return replacement.replace('\\1', match.group(1))
            return replacement
    return ""


def extract_medicines(raw_text):
    """
    Main extraction function.
    Takes raw OCR text and returns a list of structured medicine dicts.

    Args:
        raw_text: Raw text string from OCR output

    Returns:
        List of dicts: [{"name": "Amoxicillin", "dosage": "500mg", "frequency": "twice daily"}, ...]
    """
    if not raw_text:
        return []

    lines = raw_text.split('\n')
    medicines = []
    global_frequency = ""  # Frequency that applies to all if stated generically

    for line in lines:
        line = _clean_line(line)
        if not line:
            continue

        # Skip doctor/patient/header lines
        if _is_skip_line(line):
            continue

        # Check for a global frequency line (e.g., "Take twice daily after meals")
        freq = _extract_frequency(line)
        if freq and not DOSAGE_PATTERN.search(line):
            # This line is just a frequency instruction, not a medicine
            # Check if it has any medicine-like words
            has_medicine = False
            for word in re.split(r'[\s,.\-;:]+', line):
                _, score = _fuzzy_match_medicine(word)
                if score >= 0.6:
                    has_medicine = True
                    break
            if not has_medicine:
                global_frequency = freq
                continue

        # Try to find medicine name in this line
        # Split on common delimiters and try each word/phrase
        words = re.split(r'[\s,.\-;:]+', line)
        found_medicine = None
        best_score = 0

        # Try individual words first
        for word in words:
            name, score = _fuzzy_match_medicine(word)
            if score > best_score:
                best_score = score
                found_medicine = name

        # Also try two-word combinations (e.g., "Cough Syrup")
        for i in range(len(words) - 1):
            phrase = f"{words[i]} {words[i+1]}"
            name, score = _fuzzy_match_medicine(phrase)
            if score > best_score:
                best_score = score
                found_medicine = name

        if found_medicine and best_score >= 0.6:
            dosage = _extract_dosage(line)
            frequency = _extract_frequency(line) or global_frequency

            # Avoid duplicates
            already_added = any(m['name'].lower() == found_medicine.lower() for m in medicines)
            if not already_added:
                medicines.append({
                    "name": found_medicine,
                    "dosage": dosage,
                    "frequency": frequency,
                })

    return medicines


# ─── Standalone test ──────────────────────────────────────────────────
if __name__ == "__main__":
    import json

    samples = [
        # Clean
        "Amoxicillin 500mg\nIbuprofen 200mg\nTake twice daily after meals",
        # Messy (typical TrOCR output)
        "Amoxicilin 500 mg\nParacetamol 650mg tab\n1 tab 3x daily\nCetirizine 10 mg at night",
        # Noisy (bad handwriting)
        "Anoxicillin 500mg\nMetforrnin 500mg\nAtorvastaten 20mg nightly",
        # Real OCR output from our test
        "0 0 Dr. Amit Sharma 0 0\n0 0 MD Internal Medicine 0 0\n0 0 t91-9876543210 0 0\n0 0 patient : anil kumar 24 104,204 0 0\n0 0 age : 45. 0 0\n0 0 rx 0 tab . Augment since 625a.ing 0 0 0 0\n0 0 t cap . ParticipidanceDaily before breakfast 0 0\n0 0 0 tab . Paracetamolued500 mg- 0 0\n0 symp . cough Syrup - 2 tsp thrice daily 0 0\n0 0 Dr. Amit Sharma 0 0\n511",
    ]

    for i, sample in enumerate(samples, 1):
        print(f"\n{'='*50}")
        print(f"SAMPLE {i}:")
        print(f"{'='*50}")
        print(f"Input:\n{sample}\n")
        result = extract_medicines(sample)
        print(f"Output:\n{json.dumps(result, indent=2)}")
