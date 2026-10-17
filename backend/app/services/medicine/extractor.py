import os
import re
import spacy

def parse_dosage_schedule(text: str) -> dict:
    """
    Extracts numeric matrices (1-0-1, 1 - 0 - 1, 0-0-1, 1-1-1) and clinical codes (BD, OD, TDS, HS)
    from frequency and instruction strings, returning visual alarm slots.
    """
    default_slots = {"morning": False, "afternoon": False, "night": False}
    if not text or not isinstance(text, str):
        return {"schedule_text": "", "schedule_slots": default_slots}

    raw = text.lower().strip()

    # 1. Regex search for 3-slot matrix (e.g., 1-0-1, 1 - 0 - 1, 1/2-0-1/2)
    matrix_match = re.search(r'(\d+(?:/\d+)?|\d*\.\d+)\s*-\s*(\d+(?:/\d+)?|\d*\.\d+)\s*-\s*(\d+(?:/\d+)?|\d*\.\d+)', raw)
    if matrix_match:
        m, a, n = matrix_match.group(1), matrix_match.group(2), matrix_match.group(3)
        slots = {
            "morning": m not in ("0", "0.0", "", "none"),
            "afternoon": a not in ("0", "0.0", "", "none"),
            "night": n not in ("0", "0.0", "", "none")
        }
        active_names = []
        if slots["morning"]: active_names.append("Morning")
        if slots["afternoon"]: active_names.append("Afternoon")
        if slots["night"]: active_names.append("Night")
        
        label = " & ".join(active_names) if active_names else text
        return {"schedule_text": label, "schedule_slots": slots}

    # 2. Match standard clinical shorthand codes
    if re.search(r'\b(?:bd|bid|twice\s+daily)\b', raw):
        return {"schedule_text": "Twice daily (Morning & Night)", "schedule_slots": {"morning": True, "afternoon": False, "night": True}}
    if re.search(r'\b(?:tds|tid|thrice\s+daily)\b', raw):
        return {"schedule_text": "Thrice daily (Morning, Afternoon & Night)", "schedule_slots": {"morning": True, "afternoon": True, "night": True}}
    if re.search(r'\b(?:od|daily|once\s+daily)\b', raw):
        return {"schedule_text": "Once daily (Morning)", "schedule_slots": {"morning": True, "afternoon": False, "night": False}}
    if re.search(r'\b(?:hs|nightly|at\s+bedtime)\b', raw):
        return {"schedule_text": "Nightly at bedtime", "schedule_slots": {"morning": False, "afternoon": False, "night": True}}

    return {"schedule_text": "", "schedule_slots": default_slots}

class NLPExtractor:
    def __init__(self, model_path: str = None):
        if model_path is None:
            base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../ml_development/data/clinical_nlp_model_v2"))
            model_path = base_dir if os.path.exists(base_dir) else r"C:\Users\abhis\Desktop\prescription-digitization-system-main\ml_development\data\clinical_nlp_model_v2"

        self.nlp = None
        if os.path.exists(model_path):
            try:
                self.nlp = spacy.load(model_path)
            except Exception as e:
                print(f"[NLPExtractor] Warning: Could not load spaCy model at {model_path}: {e}")

    def validate_doctor_id(self, doc_id: str) -> bool:
        """Validates if a doctor ID contains at least 4 digits."""
        if not doc_id:
            return False
        digits = re.sub(r'[^0-9]', '', str(doc_id))
        return len(digits) >= 4

    def parse_prescription(self, raw_text: str) -> dict:
        if not raw_text:
            return {}

        clean_text = re.sub(r'[*_`#]+', ' ', raw_text)

        # 1. NLP MODEL EXTRACTION (Diseases, Advice, Medicines, Doctor ID)
        diseases = []
        advice = []
        nlp_meds = []
        doctor_id = None

        if self.nlp:
            try:
                doc = self.nlp(clean_text)
                for ent in doc.ents:
                    label = ent.label_
                    text = ent.text.strip()
                    
                    if label == "DISEASE" and text not in diseases:
                        diseases.append(text)
                    elif label == "ADVICE" and text not in advice:
                        advice.append(text)
                    elif label == "MEDICINE" and text not in nlp_meds:
                        nlp_meds.append(text)
                    elif label == "DOCTOR_ID" and not doctor_id:
                        doctor_id = text
            except Exception as e:
                print(f"[NLPExtractor] spaCy inference warning: {e}")

        # Explicit Regex / Keyword Extraction for Doctor Advice
        # Catches lines starting with Adv:, Advice:, Adv ., Adv , etc.
        lines_all = [l.strip() for l in raw_text.split('\n') if l.strip()]
        in_advice_block = False

        for l in lines_all:
            clean_line = re.sub(r'[*_`#]+', ' ', l).strip()
            if not clean_line:
                continue

            # Check if line initiates or contains an explicit advice header
            adv_match = re.search(r'^(?:Advice|Adv)\s*[:.]\s*(.*)|^Adv\s+(.*)', clean_line, re.IGNORECASE)
            if adv_match:
                in_advice_block = True
                content = (adv_match.group(1) or adv_match.group(2) or "").strip()
                content = re.sub(r'^[-•*>\d\.\)\s]+', '', content).strip()
                if content and len(content) > 2 and content not in advice:
                    advice.append(content)
                continue

            # If inside an advice block, collect subsequent bullet points or advice lines
            if in_advice_block:
                # Stop if signature, doctor info, or next section is encountered
                if re.search(r'^(?:Physician|Doctor|Dr\.|Lic\.|PTR|S2|Regd|Signature|Sign:|Date|Follow\s*up\s*:)', clean_line, re.IGNORECASE):
                    in_advice_block = False
                    continue
                # Also stop if another section starts like Rx or Diagnosis
                if re.search(r'^(?:Rx|℞|R/|Diagnosis|Dx|Patient)', clean_line, re.IGNORECASE):
                    in_advice_block = False
                    continue

                item_text = re.sub(r'^[-•*>\d\.\)\s]+', '', clean_line).strip()
                if item_text and len(item_text) > 2 and item_text not in advice:
                    advice.append(item_text)

        # 2. PATIENT & CLINIC REGEX HEURISTICS
        patient_name_match = re.search(r'(?:Patient\s*Name|Name|Pt\.?\s*Name)\s*[:.]?\s*([A-Za-z\s\.\,\-]+?)(?:\s*(?:Address|Age|Sex|Gender|Date|Wt|\n)|$)', clean_text, re.IGNORECASE)
        age_match = re.search(r'(?:Age|Yr|Years?)\s*[:.\-]?\s*(\d{1,3})', clean_text, re.IGNORECASE)
        sex_match = re.search(r'(?:Sex|Gender)\s*[:.\-]?\s*([MF](?:ale)?|Other)', clean_text, re.IGNORECASE)

        patient_name = patient_name_match.group(1).strip() if patient_name_match else None
        if patient_name and len(patient_name) < 2:
            patient_name = None

        patient_details = {
            "name": patient_name,
            "age": age_match.group(1).strip() if age_match else None,
            "sex": sex_match.group(1).strip() if sex_match else None
        }

        doc_pattern = re.search(r'(?:Physician(?:\'s)?(?:\s*Sig\.?)?|Dr\.|Doctor)\s*[:.\-]?\s*([A-Za-z\s\.\,\'\-]+?)(?:\s*(?:Lic|PTR|S2|Regd?|CONSULTANT|MBBS|MD|MS|\n)|$)', clean_text, re.IGNORECASE)
        doctor_name = None
        if doc_pattern:
            cand = doc_pattern.group(1).strip()
            cand = re.sub(r'^(?:[\'’]?s\s*)?(?:sig\.?|dr\.?|doctor)\s*', '', cand, flags=re.IGNORECASE).strip()
            cand = re.sub(r'[:.\-]+$', '', cand).strip()
            if cand and len(cand) > 1 and cand.lower() not in ('sign', 'signature'):
                doctor_name = cand

        if not doctor_id:
            id_match = re.search(r'(?:Regd No|Lic No|PTR|S2|Reg\.?\s*No)[\s\.:]*([A-Za-z0-9\-]+)', clean_text, re.IGNORECASE)
            if id_match:
                doctor_id = id_match.group(1).strip()

        # Hospital Name Extraction & Sanitization
        hospital_name = None
        for l in lines_all:
            if re.search(r'\b(?:Hospital|Clinic|Medical Sciences|Health Centre|Nursing Home)\b', l, re.IGNORECASE):
                if not re.search(r'^(?:Visit|Go to|Refer|Advise|Adv|Rx|Dr\.|Physician|Date|Patient)', l, re.IGNORECASE):
                    cand = l.strip()
                    # Strip isolated numeric strings like 5/5, 1/1, dates, or page numbers at the start
                    cand = re.sub(r'^(?:(?:Page|Ref|No\.?|Date)\s*[:.\-]?\s*)?(?:\d+/\d+|\d+[-/]\d+[-/]\d+|\d+[\.:\)]?)\s*', '', cand, flags=re.IGNORECASE).strip()
                    cand = re.sub(r'^[^\w\s]+', '', cand).strip()
                    cand = re.sub(r'^\d+\s+', '', cand).strip()
                    if re.search(r'\b(?:Hospital|Clinic|Medical Sciences|Health Centre|Nursing Home)\b', cand, re.IGNORECASE):
                        hospital_name = cand
                        break

        if not hospital_name:
            hosp_match = re.search(r'([A-Za-z0-9\s,\.\-/\&]+(?:Hospital|Clinic|Medical Sciences|Health Centre|Nursing Home))', clean_text, re.IGNORECASE)
            if hosp_match:
                cand = hosp_match.group(1).strip()
                cand = re.sub(r'^(?:(?:Page|Ref|No\.?|Date)\s*[:.\-]?\s*)?(?:\d+/\d+|\d+[-/]\d+[-/]\d+|\d+[\.:\)]?)\s*', '', cand, flags=re.IGNORECASE).strip()
                cand = re.sub(r'^[^\w\s]+', '', cand).strip()
                cand = re.sub(r'^\d+\s+', '', cand).strip()
                if cand and len(cand) > 3 and re.search(r'\b(?:Hospital|Clinic|Medical Sciences|Health Centre|Nursing Home)\b', cand, re.IGNORECASE):
                    hospital_name = cand

        # 3. STRUCTURAL LIST PARSER FOR MEDICATIONS
        lines = [l.strip() for l in raw_text.split('\n') if l.strip()]
        rx_lines = []
        in_rx = False

        for line in lines:
            clean_l = re.sub(r'[*_`]+', ' ', line).strip()
            if re.search(r'\b(?:Rx|℞|R/)\b', clean_l, re.IGNORECASE):
                in_rx = True
                continue
            if in_rx:
                if re.search(r'(?:Physician|Doctor|Lic\.|PTR|S2|Regd|Dr\.|Advice|Advise|^Adv\s*[:.]|^Adv\s+)', clean_l, re.IGNORECASE):
                    break
                rx_lines.append(clean_l)

        if not rx_lines:
            for line in lines:
                clean_l = re.sub(r'[*_`]+', ' ', line).strip()
                if re.search(r'^(?:Name|Address|Age|Sex|Date|Gender|Hospital|Clinic|Physician|Doctor|Lic|PTR|S2|Regd|Timing|Adv|Advice)', clean_l, re.IGNORECASE):
                    continue
                rx_lines.append(clean_l)

        def is_rx_continuation(l: str) -> bool:
            clean = l.strip()
            if not clean:
                return False
            # 1. Starts with matrix pattern (e.g., 1-0-1, 0-1-0, 1 - 0 - 1, 1/2-0-1/2)
            if re.search(r'^(?:\d+(?:/\d+)?|\d*\.\d+)\s*-\s*(?:\d+(?:/\d+)?|\d*\.\d+)\s*-\s*(?:\d+(?:/\d+)?|\d*\.\d+)', clean):
                return True
            # 2. Starts with clinical shorthand (e.g., BD, TDS, OD, TID, QID, HS, etc.)
            if re.search(r'^(?:BD|BID|TDS|TID|OD|QID|HS|STAT|SOS|PRN)\b', clean, re.IGNORECASE):
                return True
            # 3. Starts with parentheses (
            if clean.startswith('('):
                return True
            # 4. Starts with dosage/frequency/instructions/timing/duration keywords
            if re.search(r'^(?:Dosage|Qty|Quantity|Frequency|Instructions?|Duration|Timing|Sig|Take)[:\-\s]*', clean, re.IGNORECASE):
                return True
            # 5. Starts with instructions phrasing like "for 5 days", "after food", etc.
            if re.search(r'^(?:for\s+\d+|after\s+food|before\s+food|with\s+food|at\s+bedtime|empty\s+stomach)', clean, re.IGNORECASE):
                return True
            return False

        merged_lines = []
        for line in rx_lines:
            if is_rx_continuation(line) and merged_lines:
                merged_lines[-1] += " " + line
            else:
                merged_lines.append(line)

        raw_meds = []
        for line in merged_lines:
            line_clean = line

            # Defensive fallback: if line is a continuation and we have parsed meds, attach to previous
            if is_rx_continuation(line_clean) and raw_meds:
                freq_m = re.search(r'(\d+(?:/\d+)?\s*-\s*\d+(?:/\d+)?\s*-\s*\d+(?:/\d+)?|\b(?:BD|BID|OD|TDS|TID|QID|HS|STAT|SOS)\b)', line_clean, re.IGNORECASE)
                if freq_m and not raw_meds[-1].get("frequency"):
                    raw_meds[-1]["frequency"] = freq_m.group(1).strip()
                
                dur_m = re.search(r'\b(?:for\s+)?(\d+\s*(?:days?|weeks?|months?))\b', line_clean, re.IGNORECASE)
                if dur_m and not raw_meds[-1].get("duration"):
                    raw_meds[-1]["duration"] = dur_m.group(0).strip()

                timing_m = re.search(r'\b(after\s+food|before\s+food|with\s+food|empty\s+stomach|at\s+bedtime|after\s+meals?|before\s+meals?)\b', line_clean, re.IGNORECASE)
                if timing_m and not raw_meds[-1].get("timing"):
                    raw_meds[-1]["timing"] = timing_m.group(1).strip()
                continue

            is_med = False
            if re.search(r'(\b\d+-\d+-\d+(?:[\|\-\s]\d+-\d+-\d+)?\b|\b(?:BD|OD|TDS|TID|QID|HS|STAT|SOS)\b)', line_clean, re.IGNORECASE):
                is_med = True
            elif re.search(r'^(?:\d+[\.\)\-]?\s*)?[\-\*]?\s*(?:T\.|Tab|C\.|Cap|Syp|Inj|Syrup|Tablet|Capsule|Injection|Oint|Gel|Cream|Drops)', line_clean, re.IGNORECASE):
                is_med = True
            elif re.search(r'\b(?:\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|IU|units?))\b', line_clean, re.IGNORECASE):
                is_med = True
                
            if is_med:
                form_val = ""
                if re.search(r'\b(?:T\.|Tab|Tablet)s?(?:\b|\s|\.)', line_clean, re.IGNORECASE): form_val = "Tab"
                elif re.search(r'\b(?:C\.|Cap|Capsule)s?(?:\b|\s|\.)', line_clean, re.IGNORECASE): form_val = "Cap"
                elif re.search(r'\b(?:Syp|Syrup)\b', line_clean, re.IGNORECASE): form_val = "Syrup"
                elif re.search(r'\b(?:Inj|Injection)\b', line_clean, re.IGNORECASE): form_val = "Injection"
                elif re.search(r'\b(?:Oint|Ointment)\b', line_clean, re.IGNORECASE): form_val = "Ointment"
                elif re.search(r'\b(?:Gel|Cream|Drops?)\b', line_clean, re.IGNORECASE): form_val = "Drops"
                
                freq_match = re.search(r'(\d+(?:/\d+)?\s*-\s*\d+(?:/\d+)?\s*-\s*\d+(?:/\d+)?|\b(?:BD|BID|OD|TDS|TID|QID|HS|STAT|SOS)\b)', line_clean, re.IGNORECASE)
                freq_val = freq_match.group(1).strip() if freq_match else ""
                if freq_match:
                    line_clean = line_clean.replace(freq_match.group(0), ' ')
                
                strength_match = re.search(r'(\d+(?:\.\d+)?\s*(?:mg|g|ml|mcg|units?|IU))', line_clean, re.IGNORECASE)
                strength_val = strength_match.group(1) if strength_match else ""
                if strength_match:
                    line_clean = line_clean.replace(strength_match.group(0), ' ')

                dur_match = re.search(r'\b(?:for\s+)?(\d+\s*(?:days?|weeks?|months?))\b', line_clean, re.IGNORECASE)
                dur_val = dur_match.group(0).strip() if dur_match else ""
                if dur_match:
                    line_clean = line_clean.replace(dur_match.group(0), ' ')

                timing_match = re.search(r'\b(after\s+food|before\s+food|with\s+food|empty\s+stomach|at\s+bedtime|after\s+meals?|before\s+meals?)\b', line_clean, re.IGNORECASE)
                timing_val = timing_match.group(1).strip() if timing_match else ""
                if timing_match:
                    line_clean = line_clean.replace(timing_match.group(0), ' ')
                
                name_clean = line_clean
                name_clean = re.sub(r'^(?:\d+[\.\)\-]?\s*)?[\-\*]?\s*', '', name_clean)
                name_clean = re.sub(r'^(?:T\.|Tab\.?|Tablet|C\.|Cap\.?|Capsule|Syp\.?|Syrup|Inj\.?|Injection|Oint\.?|Gel|Cream|Drops?)\s*', '', name_clean, flags=re.IGNORECASE)
                name_clean = re.sub(r'\(\s*for\s+[^)]+\)', ' ', name_clean, flags=re.IGNORECASE)
                name_clean = re.sub(r'\(\s*\d+\s*(?:days?|weeks?|months?|tab|cap)?\s*\)', ' ', name_clean, flags=re.IGNORECASE)
                name_clean = re.sub(r'\(\s*\d+\s*\)', ' ', name_clean)
                name_clean = re.sub(r'\([A-Za-z0-9\s/.,-]+\)', ' ', name_clean)
                name_clean = re.sub(r'\b(?:Dosage|Qty|Quantity|Frequency|Instructions?|Duration|Timing)[:\-]?\s*', ' ', name_clean, flags=re.IGNORECASE)
                name_clean = re.sub(r'[\|\*:]', ' ', name_clean)
                name_clean = re.sub(r'\s+', ' ', name_clean).strip(" -.,")
                
                if name_clean and len(name_clean) > 2:
                    raw_meds.append({
                        "drug": name_clean,
                        "strength": strength_val,
                        "form": form_val,
                        "frequency": freq_val,
                        "duration": dur_val,
                        "timing": timing_val
                    })

        # 4. FALLBACK TO SPACY MEDS IF LIST PARSER FOUND NOTHING
        if not raw_meds and nlp_meds:
            for m in nlp_meds:
                if len(m) > 2:
                    raw_meds.append({"drug": m, "strength": "", "form": "", "frequency": ""})

        # 5. SCHEMA NORMALIZATION FOR FRONTEND STATE
        normalized_medicines = []
        scanned_drugs = []
        for m in raw_meds:
            d_val = m.get('drug') or 'Medication'
            s_val = m.get('strength') or ''
            f_val = m.get('form') or ''
            freq_val = m.get('frequency') or ''
            dur_val = m.get('duration') or ''
            timing_val = m.get('timing') or ''

            sched_info = parse_dosage_schedule(freq_val)

            parts = [p for p in [s_val, f_val, freq_val, dur_val, timing_val] if p]
            instructions = ' • '.join(parts) if parts else 'As directed by physician'

            med_obj = {
                "drug_name": d_val,
                "drug": d_val,
                "name": d_val,
                "strength": s_val,
                "dosage": s_val,
                "form": f_val,
                "frequency": freq_val,
                "schedule_text": sched_info.get("schedule_text", ""),
                "schedule_slots": sched_info.get("schedule_slots"),
                "duration": dur_val,
                "timing": timing_val,
                "instructions": instructions,
                "details": instructions,
                "dosage_formatted": instructions
            }
            normalized_medicines.append(med_obj)
            if d_val and d_val.lower() != "medication":
                scanned_drugs.append(d_val)

        has_signature = bool(re.search(r'(?:Signature of Doctor|[Signature]|Physician\'s Sig|Sign:)', clean_text, re.IGNORECASE))

        return {
            "doctor_name": doctor_name,
            "hospital_name": hospital_name,
            "patient_name": patient_details.get("name"),
            "patient_age": patient_details.get("age"),
            "patient_sex": patient_details.get("sex"),
            "patient_details": patient_details,
            "diseases_identified": diseases,
            "doctor_suggestions": advice,
            "doctor_advice": advice,
            "medicines": normalized_medicines,            # BOTH KEYS ARE NOW RETURNED
            "medicines_extracted": normalized_medicines,  # PREVENTS UI EMPTY STATE
            "prescribed_medications": normalized_medicines,
            "scanned_drugs": scanned_drugs,
            "doctor_id": doctor_id,
            "license_code": doctor_id,
            "doctor_license_number": doctor_id,
            "is_doctor_id_valid": self.validate_doctor_id(doctor_id),
            "doctor_license_validated": self.validate_doctor_id(doctor_id),
            "sign_present": has_signature,
            "signature_verified": has_signature,
            "raw_text": raw_text,
            "extracted_raw_text": raw_text
        }