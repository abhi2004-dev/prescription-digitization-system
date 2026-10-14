import os
import re
import spacy

def parse_dosage_schedule(frequency_str: str) -> dict:
    """
    Translates numeric and fractional dosage schedules tagged by the NLP model
    into human-readable plain English timing instructions and visual schedule slots.
    
    Examples:
    - '1-0-1'       -> {'schedule_text': 'Morning & Night', 'schedule_slots': {'morning': True, 'afternoon': False, 'night': True}}
    - '1/2-1/2-0'   -> {'schedule_text': 'Morning half, Afternoon half', 'schedule_slots': {'morning': True, 'afternoon': True, 'night': False}}
    - '1-1-1'       -> {'schedule_text': 'Morning, Afternoon & Night', 'schedule_slots': {'morning': True, 'afternoon': True, 'night': True}}
    - '0-0-1/2'     -> {'schedule_text': 'Night half', 'schedule_slots': {'morning': False, 'afternoon': False, 'night': True}}
    - 'tds'         -> {'schedule_text': 'Thrice daily (Morning, Afternoon & Night)', 'schedule_slots': {'morning': True, 'afternoon': True, 'night': True}}
    - 'bd'          -> {'schedule_text': 'Twice daily (Morning & Night)', 'schedule_slots': {'morning': True, 'afternoon': False, 'night': True}}
    - 'od'          -> {'schedule_text': 'Once daily (Morning)', 'schedule_slots': {'morning': True, 'afternoon': False, 'night': False}}
    """
    default_slots = {"morning": False, "afternoon": False, "night": False}
    if not frequency_str or not isinstance(frequency_str, str):
        return {"schedule_text": "", "schedule_slots": default_slots}
    
    freq = frequency_str.strip()
    if not freq:
        return {"schedule_text": "", "schedule_slots": default_slots}

    # Normalize whitespace around hyphens e.g. '1 - 0 - 1' -> '1-0-1'
    freq_norm = re.sub(r'\s*-\s*', '-', freq)

    # Common standard clinical abbreviation mappings
    abbreviations = {
        "od": ("Once daily (Morning)", {"morning": True, "afternoon": False, "night": False}),
        "bd": ("Twice daily (Morning & Night)", {"morning": True, "afternoon": False, "night": True}),
        "bid": ("Twice daily (Morning & Night)", {"morning": True, "afternoon": False, "night": True}),
        "tds": ("Thrice daily (Morning, Afternoon & Night)", {"morning": True, "afternoon": True, "night": True}),
        "tid": ("Thrice daily (Morning, Afternoon & Night)", {"morning": True, "afternoon": True, "night": True}),
        "qid": ("Four times daily", {"morning": True, "afternoon": True, "night": True}),
        "hs": ("Nightly at bedtime", {"morning": False, "afternoon": False, "night": True}),
        "sos": ("As needed (SOS)", {"morning": False, "afternoon": False, "night": False}),
        "prn": ("As needed (PRN)", {"morning": False, "afternoon": False, "night": False}),
        "stat": ("Immediately (STAT)", {"morning": True, "afternoon": False, "night": False}),
        "daily": ("Once daily (Morning)", {"morning": True, "afternoon": False, "night": False}),
        "nightly": ("Nightly at bedtime", {"morning": False, "afternoon": False, "night": True}),
        "once daily": ("Once daily (Morning)", {"morning": True, "afternoon": False, "night": False}),
        "twice daily": ("Twice daily (Morning & Night)", {"morning": True, "afternoon": False, "night": True}),
        "thrice daily": ("Thrice daily (Morning, Afternoon & Night)", {"morning": True, "afternoon": True, "night": True})
    }

    if freq_norm.lower() in abbreviations:
        text, slots = abbreviations[freq_norm.lower()]
        return {"schedule_text": text, "schedule_slots": slots}

    # Process hyphen-delimited schedules (e.g. 1-0-1, 1/2-1/2-0, 0-0-1/2, 1-1-1)
    if "-" in freq_norm:
        slots_map = ["Morning", "Afternoon", "Night", "Bedtime"]
        slots_key = ["morning", "afternoon", "night", "night"]
        parts = [p.strip() for p in freq_norm.split("-")]

        fraction_words = {
            "1/2": "half",
            "0.5": "half",
            "1/4": "quarter",
            "0.25": "quarter",
            "3/4": "three-quarters",
            "0.75": "three-quarters",
            "1/3": "one-third",
            "2/3": "two-thirds"
        }

        schedule_items = []
        has_custom_mod = False
        active_slots = {"morning": False, "afternoon": False, "night": False}

        for idx, raw_part in enumerate(parts):
            if idx >= len(slots_map):
                break
            slot = slots_map[idx]
            s_key = slots_key[idx]
            part = raw_part.replace(" ", "")

            if part in ("0", "0.0", "", "none", "None", "-"):
                continue

            active_slots[s_key] = True

            if part in ("1", "1.0"):
                schedule_items.append({"slot": slot, "text": slot, "is_one": True})
            elif part in fraction_words:
                has_custom_mod = True
                schedule_items.append({"slot": slot, "text": f"{slot} {fraction_words[part]}", "is_one": False})
            else:
                has_custom_mod = True
                schedule_items.append({"slot": slot, "text": f"{slot} {part}", "is_one": False})

        if not schedule_items:
            return {"schedule_text": freq, "schedule_slots": active_slots}

        if len(schedule_items) == 1:
            return {"schedule_text": schedule_items[0]["text"], "schedule_slots": active_slots}

        if not has_custom_mod:
            texts = [item["text"] for item in schedule_items]
            if len(texts) == 2:
                final_text = f"{texts[0]} & {texts[1]}"
            else:
                final_text = ", ".join(texts[:-1]) + f" & {texts[-1]}"
        else:
            texts = [item["text"] for item in schedule_items]
            final_text = ", ".join(texts)

        return {"schedule_text": final_text, "schedule_slots": active_slots}

    return {"schedule_text": freq, "schedule_slots": default_slots}

class NLPExtractor:
    def __init__(self, model_path: str = None):
        if model_path is None:
            base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../ml_development/data/clinical_nlp_model_v4"))
            model_path = base_dir if os.path.exists(base_dir) else r"C:\Users\abhis\Desktop\prescription-digitization-system-main\ml_development\data\clinical_nlp_model_v4"

        if os.path.exists(os.path.join(model_path, "model-best", "config.cfg")):
            model_path = os.path.join(model_path, "model-best")
        elif os.path.exists(os.path.join(model_path, "model-best")):
            model_path = os.path.join(model_path, "model-best")

        if not os.path.exists(model_path):
            self.nlp = None
        else:
            try:
                self.nlp = spacy.load(model_path)
            except (MemoryError, Exception):
                self.nlp = None

    def validate_doctor_id(self, doc_id: str) -> bool:
        """Validates if a doctor ID contains at least 4 digits."""
        if not doc_id:
            return False
        digits = re.sub(r'[^0-9]', '', str(doc_id))
        return len(digits) >= 4

    def clean_entity_text(self, text: str) -> str:
        """Strips leading/trailing punctuation, markdown noise, and bullet list markers from extracted text without corrupting dosage patterns."""
        if not text:
            return ""
        # Remove markdown bold/italic/backticks/hashes
        t = re.sub(r'[*_`#~]+', ' ', text)
        # Strip list markers: '1. ', '2) ', '(1) ', '[1] ', '• ', '* ', '- '
        t = re.sub(r'^(?:(?:\(?\d{1,2}\)?|\[\d{1,2}\]|[a-zA-Z])[\.\)]\s*|[•\*\#]\s*|\-\s+)+', '', t)
        t = re.sub(r'^[,\-:\s\.\*•]+', '', t)
        t = re.sub(r'[,\-:\s\.\*•]+$', '', t)
        return t.strip()

    def clean_drug_name(self, raw_name: str) -> str:
        """
        Thoroughly cleans extracted drug names by stripping leading list numbers (e.g. 1 , 2 ),
        bullets, forms (Tab, Cap, etc.), dosage remnants, and noise punctuation.
        """
        if not raw_name or not isinstance(raw_name, str):
            return ""

        name = self.clean_entity_text(raw_name)
        
        # Iteratively strip leading numbers, list markers, bullets, Rx prefixes, and forms
        prev = None
        for _ in range(5):
            if prev == name or not name:
                break
            prev = name
            
            # Strip Rx prefixes
            name = re.sub(r'^(?:Rx|R\/|℞)[:.\-\s]*', '', name, flags=re.IGNORECASE).strip()
            # Strip leading bullets, hyphens, asterisks, brackets, colons, dots, slashes
            name = re.sub(r'^[•\*\#\-\~\|\:\.\,\)\(\[\]\{\}\/\\]+\s*', '', name).strip()
            # Strip leading list numbers: e.g. "1 ", "2 ", "1.", "1)", "(1)", "[1]", "1 -", "1:"
            name = re.sub(r'^(?:(?:\(?\d{1,2}\)?|\[\d{1,2}\])[\.\)\:\-\/]?|\d{1,2})\s*', '', name).strip()
            # Strip leading form prefixes: "Tab.", "Cap.", "Inj.", "Syrup", "Tablet", "Capsule", "Drops", etc.
            name = re.sub(
                r'^(?:T\.|Tab(?:let)?s?\.?|C\.|Cap(?:sule)?s?\.?|Syp\.?|Syrup\.?|Inj(?:ection)?s?\.?|Oint(?:ment)?\.?|Drops?\.?|Gel\.?|Cream\.?|Inhal(?:er)?\.?|Susp(?:ension)?\.?|Lotion\.?)\s*',
                '',
                name,
                flags=re.IGNORECASE
            ).strip()

        # Strip lingering instructions and keywords
        name = re.sub(r'\b(?:Dosage|Qty|Quantity|Duration|Timing|Frequency|Schedule|Instructions?|for|as\s+needed|as\s+directed|as\s+required)[:\-]?\s*', ' ', name, flags=re.IGNORECASE)
        # Strip composite strength residue (e.g. 500mg, 40 mg, 75mg, 200mg/5ml)
        name = re.sub(r'\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|IU|units?|%)(?:\s*/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)?)?\b', ' ', name, flags=re.IGNORECASE)
        # Clean special characters & trailing punctuation (including slashes, hyphens, brackets)
        name = re.sub(r'[\|\*:#_~]', ' ', name)
        name = re.sub(r'[\s•\*\#\-\~\|\:\.\,\)\(\[\]\{\}\/\\]+$', '', name)
        name = re.sub(r'^[•\*\#\-\~\|\:\.\,\)\(\[\]\{\}\/\\]+', '', name)
        name = re.sub(r'\s+', ' ', name).strip(" -.,:;()[]{}/\\|")
        return name

    def split_into_zones(self, normalized_text: str) -> dict:
        """
        Splits raw prescription text into 3 rigid structural zones:
        1. Header Zone: Everything before the Rx or R/ marker (Clinic, Patient demographics, Diagnoses).
        2. Medication Zone: Everything strictly between the Rx marker and anchor words (Adv:, Advice:, Dr., Signature, Reg. No.).
        3. Footer/Advice Zone: Everything after the advice/doctor/signature anchors (Advice, Doctor metadata, Signature).
        """
        rx_marker_pattern = re.compile(
            r'(?:^|\n)\s*(?:Rx|℞|R/|Prescription\b|Medicines?\s*:|Medications?\s*:)\s*[:.\-]?\s*',
            re.IGNORECASE
        )

        footer_anchor_pattern = re.compile(
            r'(?:^|\n)\s*(?:'
            r'(?:Adv(?:ice|ise)?|Suggestions?|Instructions?|Plan|General\s*Advice|Diet|Follow\s*up|Precautions?)\s*[:.\-]'
            r'|(?:Dr\.?|Doctor|Physician|Prof\.?)\s+[A-Za-z]'
            r'|(?:Signature|Sign\b|Physician\'s\s*Sig)'
            r'|(?:Regd?\.?\s*(?:No\.?|Num)?|Lic\.?\s*(?:No\.?|Num)?|PTR\b|S2\b|Registration\s*(?:No\.?)?)'
            r')',
            re.IGNORECASE
        )

        header_zone = ""
        medication_zone = ""
        footer_zone = ""

        rx_match = rx_marker_pattern.search(normalized_text)

        if rx_match:
            header_zone = normalized_text[:rx_match.start()].strip()
            remaining = normalized_text[rx_match.end():].strip()
        else:
            # If no explicit Rx marker is present, separate Header lines (patient/clinic/date)
            # from Medication lines using medication pattern indicators.
            lines = normalized_text.split('\n')
            header_lines = []
            med_lines = []
            med_form_pattern = re.compile(
                r'\b(?:Tab(?:let)?s?|Cap(?:sule)?s?|Syp|Syrup|Inj(?:ection)?s?|Oint(?:ment)?|Drops?|Gel|Cream|Suspension|\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|IU)|1-0-1|0-1-0|1-0-0|0-0-1|1-1-1|BD|OD|TDS|QID)\b',
                re.IGNORECASE
            )
            found_med = False
            for line in lines:
                clean_l = line.strip()
                if not clean_l:
                    continue
                if not found_med and med_form_pattern.search(clean_l) and not re.search(r'^(?:Hospital|Clinic|Patient|Name|Age|Sex|Gender|Date|Diagnosis|Dx)', clean_l, re.IGNORECASE):
                    found_med = True
                if not found_med:
                    header_lines.append(clean_l)
                else:
                    med_lines.append(clean_l)

            header_zone = '\n'.join(header_lines).strip()
            remaining = '\n'.join(med_lines).strip()

        # Split remaining text into Medication Zone and Footer/Advice Zone
        footer_match = footer_anchor_pattern.search(remaining)
        if footer_match:
            medication_zone = remaining[:footer_match.start()].strip()
            footer_zone = remaining[footer_match.start():].strip()
        else:
            medication_zone = remaining.strip()
            footer_zone = ""

        return {
            "header": header_zone,
            "medication": medication_zone,
            "footer": footer_zone
        }

    def parse_prescription(self, raw_text: str) -> dict:
        if not raw_text:
            return {}

        # ---------------------------------------------------------
        # 1. PRE-PROCESS RAW TEXT & SPLIT INTO STRUCTURAL ZONES
        # ---------------------------------------------------------
        normalized_text = raw_text.replace('\r\n', '\n').replace('\r', '\n')
        clean_text = re.sub(r'[*_`#~]+', ' ', normalized_text)

        zones = self.split_into_zones(normalized_text)
        header_zone = zones["header"]
        medication_zone = zones["medication"]
        footer_zone = zones["footer"]

        clean_header = re.sub(r'[*_`#~]+', ' ', header_zone) if header_zone else clean_text
        clean_medication = re.sub(r'[*_`#~]+', ' ', medication_zone) if medication_zone else ""
        clean_footer = re.sub(r'[*_`#~]+', ' ', footer_zone) if footer_zone else ""

        # Noise tokens to filter out
        noise_tokens = {
            'days', 'day', 'weeks', 'week', 'months', 'month', 'daily', 'tab', 'cap',
            'tabs', 'caps', 'tablets', 'capsules', 'water', 'food', 'diet', 'nightly',
            'morning', 'night', 'sos', 'od', 'bd', 'tds', 'qid', 'hs', '0-1', '1-0-1',
            '1-0-0', '0-0-1', '1-1-1', 'qty', 'dosage', 'dr', 'doctor', 'lic', 'regd'
        }

        # ---------------------------------------------------------
        # 2. ZONE 1: HEADER ZONE EXTRACTION (Patient, Clinic, Diagnosis)
        # ---------------------------------------------------------
        # Extract Patient Demographics from Header Zone (fallback to clean_text if header is empty)
        patient_search_source = clean_header if clean_header else clean_text
        patient_name_match = re.search(
            r'(?:Patient\s*(?:Name)?|Name|Pt\.?\s*Name)\s*[:.\-]?\s*([A-Za-z\s\.\,\-]+?)(?:\s*(?:Address|Age|Sex|Gender|Date|Wt|Weight|Phone|Contact|Diagnosis|Rx|\n)|$)',
            patient_search_source,
            re.IGNORECASE
        )
        age_match = re.search(r'(?:Age|Yr|Years?|Old)\s*[:.\-]?\s*(\d{1,3})', patient_search_source, re.IGNORECASE)
        sex_match = re.search(r'(?:Sex|Gender)\s*[:.\-]?\s*([MF](?:ale)?|Other)', patient_search_source, re.IGNORECASE)

        patient_name = self.clean_entity_text(patient_name_match.group(1)) if patient_name_match else None
        if patient_name and len(patient_name) < 2:
            patient_name = None

        patient_details = {
            "name": patient_name,
            "age": age_match.group(1).strip() if age_match else None,
            "sex": sex_match.group(1).strip() if sex_match else None
        }

        # Extract Hospital / Clinic Name from Header Zone
        hosp_match = re.search(
            r'([A-Za-z0-9\s,\.\-&]+(?:Hospital|Clinic|Medical\s*Sciences|Health\s*Centre|Dispensary|Healthcare|Nursing\s*Home|Care\s*Center))',
            patient_search_source,
            re.IGNORECASE
        )
        hospital_name = self.clean_entity_text(hosp_match.group(1)) if hosp_match else None

        # Extract Diseases / Diagnoses from Header Zone
        regex_diseases = []
        diag_match = re.search(
            r'(?:Diagnosis|Diagnoses|Dx|Chief\s*Complaints?|C/O|Impression|Provisional\s*Diagnosis|Known\s*case\s*of)\s*[:.\-]?\s*([^\n\r]+)',
            patient_search_source,
            re.IGNORECASE
        )
        if diag_match:
            raw_diag = diag_match.group(1).strip()
            parts = re.split(r'[,;]|\band\b', raw_diag, flags=re.IGNORECASE)
            for p in parts:
                cleaned = self.clean_entity_text(p)
                if cleaned and len(cleaned) > 2 and cleaned.lower() not in noise_tokens:
                    if cleaned not in regex_diseases:
                        regex_diseases.append(cleaned)

        # ---------------------------------------------------------
        # 3. ZONE 3: FOOTER & ADVICE ZONE EXTRACTION
        # ---------------------------------------------------------
        footer_search_source = clean_footer if clean_footer else clean_text

        # Extract Doctor Advice / Instructions
        doctor_suggestions = []
        advice_match = re.search(
            r'(?:Advice|Advise|Suggestions?|Instructions?|Plan|General\s*Advice|Diet|Follow\s*up|Precautions?)\s*[:.\-]?\s*([^\n\r]+(?:\n\s*[•\-\*]\s*[^\n\r]+|\n\s*\d+[\.\)]\s*[^\n\r]+)*)',
            normalized_text,
            re.IGNORECASE
        )
        if advice_match:
            raw_adv = advice_match.group(1).strip()
            parts = re.split(r'[\n;]|\band\b|[•\-\*]|\b\d+[\.\)]', raw_adv, flags=re.IGNORECASE)
            for p in parts:
                cleaned = self.clean_entity_text(p)
                if cleaned and len(cleaned) > 2 and cleaned.lower() not in noise_tokens:
                    if cleaned not in doctor_suggestions and not any(cleaned.lower() in d.lower() for d in regex_diseases):
                        doctor_suggestions.append(cleaned)

        # Run spaCy on Footer Zone for any additional ADVICE entities
        if clean_footer and self.nlp:
            try:
                doc_footer = self.nlp(clean_footer)
                for ent in doc_footer.ents:
                    if ent.label_ == "ADVICE":
                        t = self.clean_entity_text(ent.text)
                        if t and len(t) > 2 and t.lower() not in noise_tokens and t not in doctor_suggestions:
                            doctor_suggestions.append(t)
            except Exception:
                pass

        # Deduplicate advice entries (filter out substrings of longer advice lines)
        cleaned_suggestions = []
        for a in sorted(doctor_suggestions, key=len, reverse=True):
            if not any(a.lower() != existing.lower() and a.lower() in existing.lower() for existing in cleaned_suggestions):
                cleaned_suggestions.append(a)
        doctor_suggestions = cleaned_suggestions

        # Extract Doctor Name from Footer (fallback to header letterhead)
        doc_pattern = re.search(
            r'(?:(?:Physician(?:\'s)?(?:\s*Sig\.?)?|\bDoctor\b|\bProf\b\.?|\bDr\b\.?)\s*[:.\-]?\s*([A-Za-z\s\.\,\'\-]+?)(?:\s*(?:MBBS|MD|MS|DNB|BAMS|BHMS|Lic|PTR|S2|Regd?|CONSULTANT|Physician|\n)|$))',
            footer_search_source if footer_search_source else clean_text,
            re.IGNORECASE
        )
        doctor_name = None
        if doc_pattern:
            cand = doc_pattern.group(1).strip()
            cand = re.sub(r'^(?:[\'’]?s\s*)?(?:sig\.?|\bdr\b\.?|\bdoctor\b|\bprof\b\.?)\s*', '', cand, flags=re.IGNORECASE).strip()
            cand = self.clean_entity_text(cand)
            if cand and len(cand) > 1 and not re.search(r'^(?:Hospital|Clinic|Patient|Name|Date|Advice|Advise|Drink|Rx|Sign|Signature|Reg|Lic)', cand, re.IGNORECASE):
                if cand.lower() not in noise_tokens and cand.lower() not in {'sign', 'signature', 'sd', 'doctor', 'physician', 'reg', 'lic'}:
                    doctor_name = cand

        # Extract Doctor License / Registration Number
        id_match = re.search(
            r'(?:Regd?\.?\s*(?:No\.?|Num)?|Lic\.?\s*(?:No\.?|Num)?|PTR|S2|Registration\s*(?:No\.?)?)[\s\.:]*([A-Za-z0-9\-\/]+)',
            clean_text,
            re.IGNORECASE
        )
        doctor_id = id_match.group(1).strip() if id_match else None

        # Check Signature Presence via enhanced text heuristics
        # 1. Standard signature labels and abbreviations (Sd/-, Sign:, Doctor's Sign, [Signature])
        standard_sig_match = bool(re.search(
            r'(?:\[?Signature(?:\s*(?:of\s*)?(?:Doctor|Physician))?\]?|Physician(?:\'s)?\s*Sig(?:\.?|nature)?|Sign\s*[:.\-]|Dr[\'’]?s\s*Sign|Doctor\'s\s*Sign|Sd\s*[\/\-]\s*|\bSd\b)',
            clean_text,
            re.IGNORECASE
        ))

        # 2. Isolated "Dr." on its own line (representing a doctor's signature line) or "Dr. [signature]" / "Sd/-"
        isolated_dr_match = bool(re.search(
            r'(?:^|\n)\s*(?:Dr\.?|Sd\s*[\/\-]?(?:\s*dr\.?)?)\s*(?:\n|$)',
            clean_text,
            re.IGNORECASE
        ))

        # 3. "Dr." appearing directly above or next to "Reg. No." / "Lic. No." in the footer demarcations
        dr_near_reg_match = bool(re.search(
            r'(?:Dr\.?|Sd\s*[\/\-]?)\s*(?:[A-Za-z\s\.\,\'\-]{0,30})?\s*(?:\n|\r\n|\s{2,})\s*(?:Regd?\.?\s*(?:No\.?|Num)?|Lic\.?\s*(?:No\.?|Num)?|PTR|S2|Registration)',
            footer_search_source if footer_search_source else clean_text,
            re.IGNORECASE
        ))

        # 4. Pattern like "Dr. [signature]" or "Dr. (Signed)"
        dr_signature_pattern = bool(re.search(
            r'Dr\.?\s*\[?signature\]?|Dr\.?\s*\(?signed\)?',
            clean_text,
            re.IGNORECASE
        ))

        has_signature = standard_sig_match or isolated_dr_match or dr_near_reg_match or dr_signature_pattern

        # ---------------------------------------------------------
        # 4. ZONE 2: MEDICATION ZONE (RESTRICTED PARSER & SPACY NER)
        # ---------------------------------------------------------
        non_med_keywords = {
            'hospital', 'clinic', 'medical', 'sciences', 'health', 'centre', 'dispensary',
            'patient', 'name', 'age', 'sex', 'gender', 'male', 'female', 'date', 'address',
            'doctor', 'dr', 'physician', 'lic', 'regd', 'reg', 'ptr', 's2', 'mbbs', 'md', 'ms',
            'diagnosis', 'diagnoses', 'dx', 'complaints', 'impression', 'advice', 'suggestions',
            'instructions', 'signature', 'sign', 'food', 'water', 'diet', 'before food',
            'after food', 'before meals', 'after meals', 'bedtime', 'morning', 'night'
        }

        # Run spaCy NER strictly on the Medication Zone
        spacy_meds = []
        if clean_medication and self.nlp:
            try:
                doc_med = self.nlp(clean_medication)
                for ent in doc_med.ents:
                    if ent.label_ == "MEDICINE":
                        text = self.clean_entity_text(ent.text)
                        if text and len(text) >= 2 and text.lower() not in noise_tokens and text.lower() not in non_med_keywords:
                            if text not in spacy_meds:
                                spacy_meds.append(text)
            except Exception:
                pass

        # Parse lines strictly within the Medication Zone
        med_lines_source = medication_zone if medication_zone else normalized_text
        raw_lines = [l.strip() for l in med_lines_source.split('\n') if l.strip()]

        # Multi-line Grouping:
        # When an item starts (e.g., 1 Tab., 2 Cap., 1), 2., •, -, 4 - Inj., Tab., Cap., Rx), any immediate subsequent lines
        # containing dosage patterns (1-0-1, 1/2-1/2-0, od, bd, tds, for 5 days, etc.) are merged with it.
        merged_lines = []
        item_start_pattern = re.compile(
            r'^(?:'
            # 1. Number followed by space and medical form: e.g. "1 Tab.", "2 Cap.", "3 Tab.", "4 Inj.", "1 Tab", "2 Cap", "4 - Inj.", "1. Tab"
            r'(?:\d{1,2}\s*[\.\)\:\/\-]?\s*(?:Tab(?:let)?s?\.?|Cap(?:sule)?s?\.?|Syp\.?|Syrup\.?|Inj(?:ection)?s?\.?|Oint(?:ment)?\.?|Drops?\.?|Gel\.?|Cream\.?|Inhal(?:er)?\.?|Susp(?:ension)?\.?|Lotion\.?|T\.|C\.)\b)|'
            # 2. Standard numbered lists: e.g. "1.", "1)", "(1)", "[1]", "1:", "1/"
            r'(?:(?:\(?\d{1,2}\)?|\[\d{1,2}\])\s*[\.\)\:\/]\s*)|'
            # 3. Numbered list with dash: e.g. "1 - Drug", "4 - Inj.", but NOT dosage matrix like "1 - 0 - 1"
            r'(?:\d{1,2}\s*-\s*(?!\s*(?:\d+(?:/\d+)?|\d*\.\d+)\s*-))|'
            # 4. Bullet points & leading list dashes: e.g. "•", "*", "#", "-", "–", "—", "+"
            r'(?:[•\*\#\–\—]\s*|^\s*-\s+(?![0-9]))|'
            # 5. Form at line start: e.g. "Tab. Pantoprazole", "Cap. Amoxicillin", "Inj. Diclofenac", "Syrup Azithromycin"
            r'(?:(?:Tab(?:let)?s?\.?|Cap(?:sule)?s?\.?|Syp\.?|Syrup\.?|Inj(?:ection)?s?\.?|Oint(?:ment)?\.?|Drops?\.?|Gel\.?|Cream\.?|Inhal(?:er)?\.?|Susp(?:ension)?\.?|Lotion\.?|T\.|C\.)\s+[A-Za-z])|'
            # 6. Rx / R/ prefix: e.g. "Rx Pantoprazole", "℞ Amoxicillin"
            r'(?:(?:Rx|R\/|℞)\s*[:.\-]?\s*)'
            r')',
            re.IGNORECASE
        )
        continuation_pattern = re.compile(
            r'(?:'
            # Continuation headers: "Dosage:", "Qty:", "Frequency:", "Instructions:", etc.
            r'^(?:(?:Dosage|Qty|Quantity|Frequency|Instructions?|Duration|Timing|Schedule|Directions?)[:\-\s]*)|'
            # Quantity / unit dosage at line start: "1 tab", "2 cap", "5 ml", "1 puff", "2 drops", etc.
            r'^(?:\d+(?:\.\d+)?|\d+/\d+)\s*(?:tab(?:let)?s?|cap(?:sule)?s?|tabs?|caps?|tsp|tbsp|drops?|pills?|puffs?|ml|mg|mcg|g|iu|units?|sachets?)\s*(?:daily|nightly|morning|night|after|before|with|once|twice|thrice|od|bd|tds|qid|hs|sos|stat|as\s+needed|as\s+directed|for\s+\d+|x\s*\d+|\n|$)|'
            # Parenthesized instructions: "(after meals)", "(1-0-1)", "(before food)", "(STAT)"
            r'^(?:\s*[\(\[\{][^\)\]\}]+[\)\]\}]\s*)|'
            # Dosage matrix patterns: "1 - 0 - 1", "1-0-0", "0-1-0", "1/2 - 0 - 1/2", "1 - 1 - 1"
            r'(?:^\s*(?:\d+(?:/\d+)?|\d*\.\d+)\s*-\s*(?:\d+(?:/\d+)?|\d*\.\d+)\s*-\s*(?:\d+(?:/\d+)?|\d*\.\d+))|'
            # Frequency keywords at line start: "once daily", "twice daily", "STAT", "SOS", "BD", "OD", "TDS", "QID"
            r'(?:^\s*(?:once|twice|thrice|daily|nightly|every|as\s+needed|as\s+required|as\s+directed|when\s+needed|when\s+required|before|after|with|morning|night|hs|sos|od|bd|tds|tid|qid|stat|prn)\b)|'
            # Duration patterns: "for 5 days", "x 7 days", "10 days"
            r'(?:^\s*(?:for\s+\d+|x\s*\d+|\d+\s*(?:days?|weeks?|months?|d|wks?))\b)|'
            # Timing / food relations: "before food", "after food", "empty stomach"
            r'(?:^\s*(?:before\s+food|after\s+food|before\s+meals?|after\s+meals?|empty\s+stomach|b\/f|a\/f|at\s+bedtime)\b)'
            r')',
            re.IGNORECASE
        )

        for line in raw_lines:
            clean_l = self.clean_entity_text(line)
            if not clean_l:
                continue
            # Skip any accidental header or advice echoes in medication lines
            if re.search(r'^(?:Name|Address|Age|Sex|Date|Gender|Hospital|Clinic|Physician|Doctor|Lic|PTR|S2|Regd|Diagnosis|Advice|Signature)', clean_l, re.IGNORECASE):
                continue

            # First, check if line starts a new medication item (1 Tab., 2 Cap., 1), 2., •, 4 - Inj., Tab., Cap., Rx)
            is_new_item = bool(item_start_pattern.search(line)) or bool(item_start_pattern.search(clean_l))
            
            # Second, check if line is a continuation dosage line (1-0-1, (after meals), 5 ml once daily, etc.)
            is_continuation = bool(continuation_pattern.search(clean_l)) or bool(continuation_pattern.search(line))

            # If line starts with a number followed by a word (e.g. "1 Pantoprazole" or "2 Amoxicillin") and is not a continuation
            if not is_new_item and not is_continuation and re.match(r'^\s*\d{1,2}\s+[A-Za-z]{3,}', clean_l):
                is_new_item = True

            # If the line has a clear medicine indicator (strength or medical form) and is NOT a continuation pattern, treat as new item
            has_med_indicator = bool(re.search(r'\b(?:Tab(?:let)?s?|Cap(?:sule)?s?|Syp|Syrup|Inj(?:ection)?s?|Oint(?:ment)?|Drops?|Gel|Cream|Inhaler|Suspension|Lotion|\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|IU))\b', clean_l, re.IGNORECASE))
            if not is_new_item and not is_continuation and has_med_indicator and not re.match(r'^\s*(?:take|give|apply|use|drink|eat)\b', clean_l, re.IGNORECASE):
                is_new_item = True

            if is_new_item or not merged_lines:
                merged_lines.append(clean_l)
            elif is_continuation:
                merged_lines[-1] += " " + clean_l
            else:
                # Default fallback: if not explicitly a new item or continuation, append to previous line if present
                merged_lines[-1] += " " + clean_l

        raw_meds = []
        for line_clean in merged_lines:
            # Check frequency pattern (1-0-1, 1/2-1/2-0, 0-0-1/2, BD, OD, TDS, QID, once daily, as needed, etc.)
            freq_match = re.search(
                r'(\b(?:\d+(?:/\d+)?|\d*\.\d+)\s*-\s*(?:\d+(?:/\d+)?|\d*\.\d+)\s*-\s*(?:\d+(?:/\d+)?|\d*\.\d+)(?:\s*-\s*(?:\d+(?:/\d+)?|\d*\.\d+))?\b|\b(?:BD|OD|TDS|TID|QID|Q4H|Q6H|Q8H|Q12H|PRN|SOS|HS|STAT|once\s+daily|twice\s+daily|thrice\s+daily|at\s+bedtime|nightly|daily|weekly|as\s+needed|as\s+required|as\s+directed|when\s+needed|when\s+required)\b)',
                line_clean,
                re.IGNORECASE
            )
            # Check form pattern (Tab, Cap, Syrup, Inj, etc.)
            form_match = re.search(
                r'\b(Tab(?:let)?s?|Cap(?:sule)?s?|Syrup|Syp|Inj(?:ection)?s?|Oint(?:ment)?|Drops?|Gel|Cream|Inhaler|Suspension|Lotion)\b',
                line_clean,
                re.IGNORECASE
            )
            # Check strength pattern (500mg, 10mg, 5ml, 200mg/5ml, etc.)
            strength_match = re.search(
                r'(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|IU|units?|%)(?:\s*/\s*\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml)?)?)',
                line_clean,
                re.IGNORECASE
            )
            # Check dosage quantity pattern (1 cap, 2 tsp, 1 tab, 5 drops, etc.)
            qty_match = re.search(
                r'(\b\d+(?:\.\d+)?\s*(?:tsp|tbsp|drops?|puffs?|pills?|tablets?|capsules?|tabs?|caps?)\b)',
                line_clean,
                re.IGNORECASE
            )

            is_med = bool(freq_match or form_match or strength_match or qty_match)

            if is_med:
                form_val = ""
                if form_match:
                    raw_f = form_match.group(1).lower()
                    if 'tab' in raw_f: form_val = "Tab"
                    elif 'cap' in raw_f: form_val = "Cap"
                    elif 'syp' in raw_f or 'syrup' in raw_f: form_val = "Syrup"
                    elif 'inj' in raw_f: form_val = "Injection"
                    elif 'oint' in raw_f: form_val = "Ointment"
                    elif 'drop' in raw_f: form_val = "Drops"
                    elif 'gel' in raw_f: form_val = "Gel"
                    elif 'cream' in raw_f: form_val = "Cream"
                    elif 'inhal' in raw_f: form_val = "Inhaler"
                    else: form_val = form_match.group(1).title()

                freq_val = freq_match.group(1).strip() if freq_match else ""
                strength_val = strength_match.group(1).strip() if strength_match else ""
                if not strength_val and qty_match:
                    strength_val = qty_match.group(1).strip()

                # Extract Duration (e.g., 'for 30 days', 'x 5 days', '10 days')
                duration_match = re.search(
                    r'(?:(?:for\s+)?(\d+\s*(?:days?|weeks?|months?|wks?|yrs?|d|mo))\b|\bx\s*(\d+\s*(?:days?|weeks?|months?|d)?)\b)',
                    line_clean,
                    re.IGNORECASE
                )
                duration_val = duration_match.group(0).strip() if duration_match else ""

                # Extract Timing / Food instructions (e.g., 'before food', 'after food', 'before breakfast')
                timing_match = re.search(
                    r'\b(before\s+(?:food|meals?|breakfast|lunch|dinner)|after\s+(?:food|meals?|breakfast|lunch|dinner)|with\s+food|empty\s+stomach|b\/f|a\/f|at\s+bedtime|with\s+water)\b',
                    line_clean,
                    re.IGNORECASE
                )
                timing_val = timing_match.group(1).strip() if timing_match else ""

                # Clean drug name by stripping extracted dosage artifacts
                name_clean = line_clean
                if freq_match:
                    name_clean = name_clean.replace(freq_match.group(0), ' ')
                if strength_match:
                    name_clean = name_clean.replace(strength_match.group(0), ' ')
                if qty_match:
                    name_clean = name_clean.replace(qty_match.group(0), ' ')
                if duration_match:
                    name_clean = name_clean.replace(duration_match.group(0), ' ')
                if timing_match:
                    name_clean = name_clean.replace(timing_match.group(0), ' ')
                if form_match:
                    name_clean = re.sub(r'\b' + re.escape(form_match.group(0)) + r'\b', ' ', name_clean, flags=re.IGNORECASE)

                # Extract and preserve parenthesized conditions/instructions (e.g., '(after food)', '(for pain)', '(if needed)')
                parentheses_matches = re.findall(r'\(([^)]+)\)', name_clean)
                for p_text in parentheses_matches:
                    p_clean = p_text.strip()
                    if re.search(r'\b(?:food|meals?|breakfast|lunch|dinner|pain|fever|cough|needed|required|directed|empty|stomach|bedtime|days?|tab|cap|tabs|caps|sos|od|bd|tds|qid|hs)\b', p_clean, re.IGNORECASE):
                        if not timing_val:
                            timing_val = p_clean
                        elif p_clean.lower() not in timing_val.lower():
                            timing_val += f" ({p_clean})"

                # Remove complete parenthesized groups and unclosed dangling parentheses from drug name
                name_clean = re.sub(r'\([^)]*\)', ' ', name_clean)
                name_clean = re.sub(r'[\(\[\{][^\)\]\}]*$', '', name_clean)
                name_clean = re.sub(r'^[\)\]\}]+', '', name_clean)
                name_clean = re.sub(r'[\(\)\[\]\{\}]', ' ', name_clean)

                # Clean drug name with dedicated clean_drug_name
                name_clean = self.clean_drug_name(name_clean)

                if name_clean and len(name_clean) > 2 and name_clean.lower() not in non_med_keywords and name_clean.lower() not in noise_tokens:
                    raw_meds.append({
                        "drug": name_clean,
                        "strength": strength_val,
                        "form": form_val,
                        "frequency": freq_val,
                        "duration": duration_val,
                        "timing": timing_val
                    })

        # Integrate spaCy NLP medicines extracted strictly from Medication Zone
        existing_names = [m["drug"].lower() for m in raw_meds]
        for spacy_m in spacy_meds:
            cleaned_m = self.clean_entity_text(spacy_m)
            if not cleaned_m or len(cleaned_m) < 3 or cleaned_m.lower() in non_med_keywords:
                continue

            # Skip if it is a duration, frequency, or instruction artifact
            if re.search(r'^(?:for\s+)?\d+\s*(?:days?|weeks?|months?|wks?|yrs?|d|mo|hours?|hrs?|mins?)$', cleaned_m, re.IGNORECASE) or \
               re.search(r'^\s*x\s*\d+', cleaned_m, re.IGNORECASE) or \
               re.search(r'^(?:once|twice|thrice|daily|nightly|every|before|after|with|tab|cap|syp|inj|qty|dosage|as\s+needed|as\s+required|as\s+directed|when\s+needed)\b', cleaned_m, re.IGNORECASE) or \
               cleaned_m.lower() in noise_tokens:
                continue

            # Skip if it was already captured in duration, frequency, or timing of parsed meds
            if any(cleaned_m.lower() in (m.get("duration", "") + " " + m.get("frequency", "") + " " + m.get("timing", "")).lower() for m in raw_meds):
                continue

            # Skip if it matches doctor/clinic patterns
            if any(re.search(r'\b' + re.escape(kw) + r'\b', cleaned_m, re.IGNORECASE) for kw in ['hospital', 'clinic', 'patient', 'doctor', 'physician', 'mbbs', 'male', 'female', 'reg', 'lic', 'diagnosis', 'signature']):
                continue

            if not any(cleaned_m.lower() in ex or ex in cleaned_m.lower() for ex in existing_names):
                str_m = re.search(r'(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|IU|units?|%))', cleaned_m, re.IGNORECASE)
                s_val = str_m.group(1) if str_m else ""
                clean_d_name = self.clean_drug_name(cleaned_m)

                if clean_d_name and len(clean_d_name) > 2 and clean_d_name.lower() not in non_med_keywords and clean_d_name.lower() not in noise_tokens:
                    raw_meds.append({
                        "drug": clean_d_name,
                        "strength": s_val,
                        "form": "",
                        "frequency": "",
                        "duration": "",
                        "timing": ""
                    })
                    existing_names.append(clean_d_name.lower())

        # ---------------------------------------------------------
        # 5. SCHEMA NORMALIZATION FOR FRONTEND & DRUG INTERACTIONS
        # ---------------------------------------------------------
        normalized_medicines = []
        for m in raw_meds:
            raw_d = m.get('drug') or 'Medication'
            d_val = self.clean_drug_name(raw_d) or raw_d
            s_val = m.get('strength') or ''
            f_val = m.get('form') or ''
            freq_val = m.get('frequency') or ''
            dur_val = m.get('duration') or ''
            time_val = m.get('timing') or ''

            sched_info = parse_dosage_schedule(freq_val)
            sched_text = sched_info.get("schedule_text", "")
            sched_slots = sched_info.get("schedule_slots", {"morning": False, "afternoon": False, "night": False})

            parts = [p for p in [s_val, f_val, freq_val, dur_val, time_val] if p]
            instructions = ' • '.join(parts) if parts else 'As directed by physician'

            normalized_medicines.append({
                "drug_name": d_val,
                "drug": d_val,
                "name": d_val,
                "strength": s_val,
                "dosage": s_val,
                "form": f_val,
                "frequency": freq_val,
                "schedule_text": sched_text,
                "schedule_slots": sched_slots,
                "schedule": sched_text,
                "duration": dur_val,
                "timing": time_val,
                "instructions": instructions,
                "details": instructions,
                "dosage_formatted": instructions
            })

        return {
            "doctor_name": doctor_name,
            "hospital_name": hospital_name,
            "patient_details": patient_details,
            "patient_name": patient_details.get("name"),
            "patient_age": patient_details.get("age"),
            "patient_sex": patient_details.get("sex"),
            "diseases_identified": regex_diseases,
            "doctor_suggestions": doctor_suggestions,
            "doctor_advice": doctor_suggestions,
            "medicines": normalized_medicines,
            "medicines_extracted": normalized_medicines,
            "license_code": doctor_id,
            "doctor_id": doctor_id,
            "doctor_license_number": doctor_id,
            "is_doctor_id_valid": self.validate_doctor_id(doctor_id),
            "doctor_license_validated": self.validate_doctor_id(doctor_id),
            "sign_present": has_signature,
            "signature_verified": has_signature,
            "zones": {
                "header": header_zone,
                "medication": medication_zone,
                "footer": footer_zone
            },
            "raw_text": raw_text,
            "extracted_raw_text": raw_text
        }