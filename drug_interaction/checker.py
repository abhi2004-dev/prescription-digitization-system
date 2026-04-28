"""
Drug Interaction Checker — Person 3's Module
=============================================
Takes a list of extracted medicines and checks for dangerous interactions
against a CSV database of known drug interaction pairs.
"""
import csv
import os
import logging

logger = logging.getLogger(__name__)

# ─── Load interactions CSV ────────────────────────────────────────────
_interactions_db = None


def _load_interactions():
    """Load drug interactions from CSV file (lazy, cached)."""
    global _interactions_db
    if _interactions_db is not None:
        return _interactions_db

    csv_path = os.path.join(os.path.dirname(__file__), "interactions.csv")
    _interactions_db = []

    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                _interactions_db.append({
                    "drug_1": row["drug_1"].strip().lower(),
                    "drug_2": row["drug_2"].strip().lower(),
                    "severity": row["severity"].strip(),
                    "warning_message": row["warning_message"].strip(),
                    # Keep original casing for display
                    "drug_1_display": row["drug_1"].strip(),
                    "drug_2_display": row["drug_2"].strip(),
                })
        logger.info(f"Loaded {len(_interactions_db)} drug interactions from CSV")
    except FileNotFoundError:
        logger.error(f"interactions.csv not found at {csv_path}")
    except Exception as e:
        logger.error(f"Failed to load interactions CSV: {e}")

    return _interactions_db


def check_interactions(medicines):
    """
    Check a list of medicines for dangerous interactions.

    Args:
        medicines: List of dicts from extractor, e.g.:
            [{"name": "Amoxicillin", "dosage": "500mg", "frequency": "twice daily"}, ...]

    Returns:
        List of warning dicts:
            [{"drug_1": "Aspirin", "drug_2": "Ibuprofen", "severity": "high",
              "message": "Both are NSAIDs..."}, ...]
    """
    if not medicines or len(medicines) < 2:
        return []

    interactions = _load_interactions()
    if not interactions:
        return []

    # Extract medicine names (lowercase for matching)
    medicine_names = []
    for med in medicines:
        name = med.get("name", "").strip().lower()
        if name:
            medicine_names.append(name)

    warnings = []

    # Check all pairs of medicines
    for i in range(len(medicine_names)):
        for j in range(i + 1, len(medicine_names)):
            drug_a = medicine_names[i]
            drug_b = medicine_names[j]

            for interaction in interactions:
                # Check both orderings (drug_a+drug_b and drug_b+drug_a)
                if (drug_a == interaction["drug_1"] and drug_b == interaction["drug_2"]) or \
                   (drug_a == interaction["drug_2"] and drug_b == interaction["drug_1"]):
                    warnings.append({
                        "drug_1": interaction["drug_1_display"],
                        "drug_2": interaction["drug_2_display"],
                        "severity": interaction["severity"],
                        "message": interaction["warning_message"],
                    })

    logger.info(f"Checked {len(medicine_names)} medicines, found {len(warnings)} interactions")
    return warnings


# ─── Standalone test ──────────────────────────────────────────────────
if __name__ == "__main__":
    import json

    test_cases = [
        [
            {"name": "Amoxicillin", "dosage": "500mg", "frequency": "twice daily"},
            {"name": "Ibuprofen", "dosage": "200mg", "frequency": "twice daily"},
        ],
        [
            {"name": "Aspirin", "dosage": "75mg", "frequency": "once daily"},
            {"name": "Warfarin", "dosage": "5mg", "frequency": "once daily"},
            {"name": "Ibuprofen", "dosage": "400mg", "frequency": "thrice daily"},
        ],
        [
            {"name": "Metformin", "dosage": "500mg", "frequency": "twice daily"},
            {"name": "Atorvastatin", "dosage": "20mg", "frequency": "at night"},
        ],
    ]

    for i, meds in enumerate(test_cases, 1):
        print(f"\n{'='*50}")
        print(f"TEST {i}: {[m['name'] for m in meds]}")
        print(f"{'='*50}")
        result = check_interactions(meds)
        if result:
            print(json.dumps(result, indent=2))
        else:
            print("No interactions found.")
