"""
PrescriptoAI - Comprehensive Clinical Vocabulary Generator
Expands medical terms for TrOCR training and synthetic data generation.
Covers major drug classes (generic & top brand names), formulations, strengths, and clinical regimens.
"""

# 1. Extensive Pharmaceutical Drug List (Generic Compounds & Common Brands)
drugs = [
    # --- Antibiotics & Antimicrobials ---
    "Amoxicillin", "Augmentin", "Augmentin 625", "Amox-Clav", "Azithromycin", "Aziwok", "Zithromax",
    "Ciprofloxacin", "Ciplox", "Levofloxacin", "Levaquin", "Ceftriaxone", "Cefixime", "Taxim-O", "Zifi",
    "Cefuroxime", "Ceftum", "Doxycycline", "Doxt-SL", "Metronidazole", "Flagyl", "Metrogyl",
    "Clindamycin", "Dalacin", "Erythromycin", "Clarithromycin", "Klaricid", "Nitrofurantoin",
    "Norfloxacin", "Norflox-TZ", "Ofloxacin", "Zenflox", "Trimethoprim", "Sulfamethoxazole", "Bactrim",
    "Linezolid", "Linid", "Amikacin", "Gentamicin", "Vancomycin", "Meropenem", "Piperacillin-Tazobactam",

    # --- Cardiovascular & Antihypertensives ---
    "Amlodipine", "Amlong", "Norvasc", "Telmisartan", "Telma", "Telma 40", "Telma H", "Telma AM",
    "Losartan", "Losar", "Cozaar", "Ramipril", "Cardace", "Enalapril", "Vasotec", "Lisinopril", "Zestril",
    "Atenolol", "Tenormin", "Metoprolol", "Betaloc", "Prolomet XL 25", "Prolomet XL 50", "Bisoprolol", "Concor",
    "Propranolol", "Inderal", "Hydrochlorothiazide", "HCTZ", "Furosemide", "Lasix", "Torsemide", "Dytor",
    "Spironolactone", "Aldactone", "Diltiazem", "Cardizem", "Verapamil", "Calan", "Digoxin", "Lanoxin",
    "Nitroglycerin", "Nitrocontin", "Isosorbide Mononitrate", "Monotrate", "Ivabradine", "Sacubitril-Valsartan",

    # --- Antidiabetics ---
    "Metformin", "Glucophage", "Glycomet", "Glycomet GP 1", "Glycomet GP 2", "Glimepiride", "Amaryl",
    "Gliclazide", "Diamicron", "Sitagliptin", "Januvia", "Vildagliptin", "Galvus", "Galvus Met",
    "Linagliptin", "Trajenta", "Empagliflozin", "Jardiance", "Dapagliflozin", "Forxiga", "Glipizide",
    "Pioglitazone", "Pioz", "Voglibose", "Volibo", "Insulin Glargine", "Lantus", "Human Mixtard", "Novorapid",

    # --- Analgesics, Antipyretics & NSAIDs ---
    "Paracetamol", "Acetaminophen", "Crocin", "Calpol", "Calpol 650", "Dolo 650", "P-650",
    "Ibuprofen", "Brufen", "Combiflam", "Diclofenac", "Voveran", "Voveran SR", "Aceclofenac", "Zerodol",
    "Zerodol-SP", "Zerodol-P", "Tramadol", "Ultracet", "Naproxen", "Naprosyn", "Meloxicam", "Mobic",
    "Celecoxib", "Celebrex", "Etoricoxib", "Nucoxia", "Arcoxia", "Aspirin", "Ecosprin", "Ecosprin 75",
    "Ecosprin 150", "Ketorolac", "Ketanov", "Mefenamic Acid", "Meftal", "Meftal-Spas", "Piroxicam", "Indomethacin",

    # --- Gastrointestinal & Acid Reducers ---
    "Pantoprazole", "Pantocid", "Pantocid 40", "Pan 40", "Pan-D", "Omeprazole", "Omez", "Omez-D",
    "Rabeprazole", "Rablet", "Razo", "Esomeprazole", "Nexium", "Sompraz", "Lansoprazole", "Prevacid",
    "Famotidine", "Pepcid", "Ranitidine", "Rantac", "Zantac", "Domperidone", "Vomistop", "Ondansetron",
    "Emeset", "Zofran", "Sucralfate", "Sucrafil", "Metoclopramide", "Reglan", "Perinorm", "Loperamide",
    "Imodium", "Lactulose", "Duphalac", "Dicyclomine", "Drotaverine", "Drotin-M", "Ursodeoxycholic Acid", "Udiliv",

    # --- Respiratory, Antihistamines & Allergy ---
    "Cetirizine", "Cetzine", "Zyrtec", "Levocetirizine", "Levocet", "Levocet M", "Xyzal", "Fexofenadine",
    "Allegra", "Allegra 120", "Allegra 180", "Montelukast", "Singulair", "Montek LC", "Montair LC",
    "Loratadine", "Claritin", "Bilastine", "Bilaxten", "Hydroxyzine", "Atarax", "Salbutamol", "Asthalin",
    "Albuterol", "ProAir", "Ventolin", "Budesonide", "Pulmicort", "Budecort", "Fluticasone", "Flonase",
    "Formoterol", "Foracort", "Seretide", "Ipratropium", "Duolin", "Tiotropium", "Spiriva", "Theophylline",
    "Deriphyllin", "Ambroxol", "Mucolite", "Dextromethorphan", "Ascoril", "Benadryl", "Grilinctus", "Alex",

    # --- Lipid Lowering (Statins & Fibrates) ---
    "Atorvastatin", "Lipitor", "Atorva", "Storvas", "Rosuvastatin", "Crestor", "Rosuvas", "Rozavel",
    "Simvastatin", "Zocor", "Pravastatin", "Fenofibrate", "Lipicard", "Ezetimibe", "Eztrol",

    # --- Central Nervous System & Psychiatric ---
    "Alprazolam", "Alprax", "Xanax", "Restyl", "Clonazepam", "Clonafit", "Klonopin", "Rivotril",
    "Lorazepam", "Ativan", "Trapex", "Diazepam", "Valium", "Calmpose", "Escitalopram", "Nexito", "Lexapro",
    "Sertraline", "Zoloft", "Serta", "Fluoxetine", "Prozac", "Fludac", "Paroxetine", "Paxil",
    "Amitriptyline", "Tryptomer", "Duloxetine", "Cymbalta", "Duzela", "Venlafaxine", "Effexor",
    "Gabapentin", "Neurontin", "Gabapin", "Pregabalin", "Lyrica", "Pregeb", "Maxgalin", "Levetiracetam",
    "Levipil", "Keppra", "Carbamazepine", "Tegretol", "Sodium Valproate", "Encorate", "Zolpidem", "Ambien",
    "Quetiapine", "Seroquel", "Olanzapine", "Oleanz", "Risperidone", "Baclofen", "Liofen", "Tizanidine",

    # --- Corticosteroids & Endocrine ---
    "Prednisolone", "Wysolone", "Omnacortil", "Prednisone", "Deltasone", "Methylprednisolone", "Medrol",
    "Dexamethasone", "Dexona", "Decadron", "Hydrocortisone", "Deflazacort", "Defcort", "Betamethasone", "Betnesol",
    "Levothyroxine", "Eltroxin", "Thyronorm", "Synthroid",

    # --- Antifungals & Antivirals ---
    "Fluconazole", "Diflucan", "Forcan", "Itraconazole", "Canditral", "Itaspor", "Voriconazole",
    "Terbinafine", "Tyza", "Clotrimazole", "Candid", "Ketoconazole", "Nizral", "Acyclovir", "Zovirax",
    "Valacyclovir", "Valcivir", "Oseltamivir", "Tamiflu", "Remdesivir",

    # --- Hematological, Vitamins & Minerals ---
    "Livogen", "Autrin", "Ferrous Sulfate", "Orofer XT", "Folic Acid", "Folvite", "Vitamin D3",
    "Cholecalciferol", "Calcirol 60K", "Tayom 60K", "Methylcobalamin", "Nurokind", "Optineuron", "Neurobion",
    "Neurobion Forte", "Vitamin C", "Limcee", "Celin", "Calcium Carbonate", "Shelcal", "Shelcal 500",
    "Zincovit", "Becosules", "Becadexamin", "Supradyn", "Revital", "Warfarin", "Coumadin", "Clopidogrel", "Plavix", "Deplatt"
]

# 2. Dosage Formulations
formulations = [
    "Tab", "Tablet", "Cap", "Capsule", "Syp", "Syrup", "Inj", "Injection",
    "Oint", "Ointment", "Cream", "Gel", "Drops", "Eye Drops", "Ear Drops",
    "Inhaler", "Respules", "Susp", "Suspension", "Powder", "Sachet",
    "Lotion", "Solution", "Mouthwash", "Spray", "Patch"
]

# 3. Strengths & Dosages
strengths = [
    "0.25mg", "0.5mg", "1mg", "2mg", "2.5mg", "5mg", "10mg", "15mg", "20mg", "25mg",
    "40mg", "50mg", "75mg", "80mg", "100mg", "125mg", "150mg", "200mg", "250mg", "300mg",
    "400mg", "500mg", "600mg", "650mg", "800mg", "850mg", "1000mg", "1g", "2g",
    "5ml", "10ml", "15ml", "100ml", "200ml", "500ml",
    "1000IU", "60000IU", "0.05%", "0.1%", "1%", "2%", "5%"
]

# 4. Clinical Frequencies, Timings & Regimens
regimens = [
    # Latin / Shorthand notations
    "OD", "BD", "BID", "TDS", "TID", "QID", "SOS", "HS", "QHS", "Stat", "PRN", "AC", "PC",
    "1-0-1", "1-1-1", "1-0-0", "0-0-1", "0-1-0", "1-1-0", "0-1-1", "1-1-1-1",
    "1/2 Tab", "1 Tab", "2 Tabs", "1 Cap", "2 Caps", "1 tsp", "2 tsp", "5 ml", "10 ml",

    # Plain English instructions
    "once daily", "twice daily", "thrice daily", "four times daily",
    "every 6 hours", "every 8 hours", "every 12 hours",
    "before breakfast", "after breakfast", "before lunch", "after lunch",
    "before dinner", "after dinner", "at bedtime", "on empty stomach",
    "with meals", "after meals", "before meals", "with water", "as needed", "as needed for pain",

    # Durations
    "for 3 days", "for 5 days", "for 7 days", "for 10 days", "for 14 days", "for 21 days", "for 1 month",
    "continue", "stat dose"
]

def main():
    all_terms = sorted(list(set(drugs + formulations + strengths + regimens)))
    output_path = "medical_terms.txt"
    
    with open(output_path, "w", encoding="utf-8") as f:
        for term in all_terms:
            f.write(term + "\n")
            
    print("="*60)
    print(f"[OK] Successfully compiled {len(all_terms)} clinical terms into '{output_path}'.")
    print(f"   - Unique Drugs/Brands:      {len(set(drugs))}")
    print(f"   - Dosage Formulations:      {len(set(formulations))}")
    print(f"   - Strengths & Metrics:      {len(set(strengths))}")
    print(f"   - Instructions & Regimens:  {len(set(regimens))}")
    print("="*60)

if __name__ == "__main__":
    main()