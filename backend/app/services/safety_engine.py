import os
import re
import sqlite3
from typing import List, Dict, Any, Union

def get_db_path():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    app_db = os.path.join(base_dir, "database", "mediscan.db")
    if os.path.exists(app_db):
        return app_db
    alt_db = os.path.abspath(os.path.join(base_dir, "../../../mediscan.db"))
    if os.path.exists(alt_db):
        return alt_db
    return app_db

def clean_drug_name(name: str) -> str:
    """Extracts clean generic / brand drug name by removing dosages, formulations, and punctuation."""
    if not name:
        return ""
    cleaned = str(name).lower().strip()
    # Remove dosage units (e.g. 500mg, 10 mg, 5ml, 2.5mg, 100mcg, 10%)
    cleaned = re.sub(r'\b\d+(\.\d+)?\s*(mg|mcg|g|ml|iu|units|%|tablets?|capsules?|tabs?|caps?)\b', '', cleaned, flags=re.IGNORECASE)
    # Remove standalone numbers
    cleaned = re.sub(r'\b\d+\b', '', cleaned)
    # Remove extraneous punctuation
    cleaned = re.sub(r'[^a-z0-9\s\-]', ' ', cleaned)
    # Collapse whitespace
    cleaned = ' '.join(cleaned.split()).strip()
    return cleaned

def check_interactions(
    scanned_drugs: List[Union[str, Dict[str, Any]]],
    profile_drugs: List[Union[str, Dict[str, Any]]]
) -> List[Dict[str, Any]]:
    """
    Generates all pairwise comparisons between scanned_drugs and profile_drugs (and within scanned_drugs).
    Queries the SQLite drug_interactions table and returns structured results.
    """
    scanned_items = []
    for d in scanned_drugs:
        if isinstance(d, dict):
            raw = d.get("drug_name") or d.get("name") or ""
        else:
            raw = str(d)
        if raw.strip():
            scanned_items.append((raw.strip(), clean_drug_name(raw)))

    profile_items = []
    for d in profile_drugs:
        if isinstance(d, dict):
            raw = d.get("drug_name") or d.get("name") or ""
        else:
            raw = str(d)
        if raw.strip():
            profile_items.append((raw.strip(), clean_drug_name(raw)))

    if not scanned_items:
        return []

    db_path = get_db_path()
    if not os.path.exists(db_path):
        return []

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    results = []
    seen_pairs = set()

    # 1. Compare scanned_drugs with profile_drugs (cross-medication interaction)
    for orig_scan, clean_scan in scanned_items:
        if not clean_scan:
            continue
        for orig_prof, clean_prof in profile_items:
            if not clean_prof or clean_scan == clean_prof:
                continue

            # Alphabetize pair: drug_1 <= drug_2
            d1, d2 = (clean_scan, clean_prof) if clean_scan <= clean_prof else (clean_prof, clean_scan)
            pair_key = (d1, d2)
            if pair_key in seen_pairs:
                continue

            cursor.execute(
                "SELECT level, interaction FROM drug_interactions WHERE drug_1 = ? AND drug_2 = ? LIMIT 1;",
                (d1, d2)
            )
            row = cursor.fetchone()

            if not row:
                # Substring / wildcard search for combination names (e.g., 'amoxicillin' in 'amoxicillin / clavulanate')
                cursor.execute(
                    """
                    SELECT level, interaction FROM drug_interactions 
                    WHERE (drug_1 LIKE ? AND drug_2 LIKE ?) OR (drug_1 LIKE ? AND drug_2 LIKE ?)
                    LIMIT 1;
                    """,
                    (f"{d1}%", f"{d2}%", f"{d2}%", f"{d1}%")
                )
                fuzzy_row = cursor.fetchone()
                if fuzzy_row:
                    row = (fuzzy_row[0], fuzzy_row[1])

            if row:
                seen_pairs.add(pair_key)
                level = row[0] or "Moderate"
                description = row[1] or f"Potential interaction identified between {orig_scan} and {orig_prof}."
                results.append({
                    "drug_1": orig_scan,
                    "drug_2": orig_prof,
                    "level": level,
                    "description": description,
                    "severity": level
                })

    # 2. Pairwise check between scanned drugs themselves (if multiple drugs on same prescription)
    for i in range(len(scanned_items)):
        orig_a, clean_a = scanned_items[i]
        if not clean_a:
            continue
        for j in range(i + 1, len(scanned_items)):
            orig_b, clean_b = scanned_items[j]
            if not clean_b or clean_a == clean_b:
                continue

            d1, d2 = (clean_a, clean_b) if clean_a <= clean_b else (clean_b, clean_a)
            pair_key = (d1, d2)
            if pair_key in seen_pairs:
                continue

            cursor.execute(
                "SELECT level, interaction FROM drug_interactions WHERE drug_1 = ? AND drug_2 = ? LIMIT 1;",
                (d1, d2)
            )
            row = cursor.fetchone()

            if not row:
                cursor.execute(
                    """
                    SELECT level, interaction FROM drug_interactions 
                    WHERE (drug_1 LIKE ? AND drug_2 LIKE ?) OR (drug_1 LIKE ? AND drug_2 LIKE ?)
                    LIMIT 1;
                    """,
                    (f"{d1}%", f"{d2}%", f"{d2}%", f"{d1}%")
                )
                fuzzy_row = cursor.fetchone()
                if fuzzy_row:
                    row = (fuzzy_row[0], fuzzy_row[1])

            if row:
                seen_pairs.add(pair_key)
                level = row[0] or "Moderate"
                description = row[1] or f"Potential interaction identified between {orig_a} and {orig_b}."
                results.append({
                    "drug_1": orig_a,
                    "drug_2": orig_b,
                    "level": level,
                    "description": description,
                    "severity": level
                })

    conn.close()
    return results
