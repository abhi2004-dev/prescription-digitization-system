# List of 40+ common drugs for high-variance training
drugs = [
    "Atorvastatin", "Levothyroxine", "Lisinopril", "Metformin", "Amlodipine", 
    "Metoprolol", "Albuterol", "Omeprazole", "Losartan", "Gabapentin", 
    "Sertraline", "Simvastatin", "Montelukast", "Hydrochlorothiazide", 
    "Pantoprazole", "Furosemide", "Fluticasone", "Escitalopram", "Fluoxetine", 
    "Rosuvastatin", "Bupropion", "Amoxicillin", "Dextroamphetamine", "Trazodone", 
    "Duloxetine", "Prednisone", "Tamsulosin", "Venlafaxine", "Pravastatin", 
    "Meloxicam", "Azithromycin", "Carvedilol", "Warfarin", "Clopidogrel", 
    "Zolpidem", "Aspirin", "Ibuprofen", "Tramadol", "Clotrimazole", "Diclofenac"
]

# Common dosage instructions
instructions = [
    "once daily", "twice daily", "thrice daily", "every 8 hours", 
    "before breakfast", "after meals", "at bedtime", "as needed", 
    "5mg", "10mg", "20mg", "40mg", "75mg", "100mg", "500mg", "1g",
    "Tablet", "Capsule", "Syrup", "Injection"
]

# Write to medical_terms.txt
with open("medical_terms.txt", "w") as f:
    for item in drugs + instructions:
        f.write(item + "\n")

print(f"Successfully updated medical_terms.txt with {len(drugs) + len(instructions)} terms.")