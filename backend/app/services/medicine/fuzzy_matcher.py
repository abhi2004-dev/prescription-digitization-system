from rapidfuzz import process, fuzz

# Authorized vocabulary based on the training dataset limitations
KNOWN_DICTIONARY = [
    "Atorvastatin", "Metformin", "Amoxicillin", "Aspirin", "Warfarin",
    "Cefixime", "Telmisartan", "Hydrochlorothiazide", "Ibuprofen", "Omeprazole",
    "Azithromycin", "Ciprofloxacin", "Losartan", "Amlodipine", "Pantoprazole",
    "Rabeprazole", "Paracetamol", "Diclofenac", "Cetirizine", "Levocetirizine",
    "Montelukast", "Ondansetron", "Domperidone", "Ranitidine", "Clopidogrel",
    "Rosuvastatin", "Glimepiride", "Gliclazide", "Vildagliptin", "Sitagliptin",
    "Teneligliptin", "Dapagliflozin", "Metoprolol", "Bisoprolol", "Carvedilol",
    "Levothyroxine", "Escitalopram", "Fluconazole", "Doxycycline", "Linezolid",
    "Tablet", "Capsule", "Injection", "Syrup", "Ointment", "Drops",
    "once daily", "twice daily", "thrice daily", "at bedtime", "after meals", "before meals",
    "500mg", "250mg", "100mg", "50mg", "10mg", "5mg"
]

def resolve_entities(extracted_texts: list[str], threshold: float = 75.0) -> list[str]:
    resolved_list = []
    
    for text in extracted_texts:
        if len(text) < 3:
            continue
            
        match = process.extractOne(text, KNOWN_DICTIONARY, scorer=fuzz.WRatio)
        
        if match:
            best_string, score, _index = match
            if score >= threshold:
                resolved_list.append(best_string)

    seen = set()
    return [x for x in resolved_list if not (x in seen or seen.add(x))]