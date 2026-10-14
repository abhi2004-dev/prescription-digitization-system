import os
import re
import sqlite3
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

def _get_db_path() -> str:
    """Resolve the SQLite database path."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    app_db = os.path.join(current_dir, "database", "mediscan.db")
    if os.path.exists(app_db):
        return app_db
    
    root_db = os.path.join(os.path.dirname(os.path.dirname(current_dir)), "mediscan.db")
    if os.path.exists(root_db):
        return root_db
        
    return app_db

def verify_license(reg_no: Optional[str]) -> Dict[str, Any]:
    """
    Query the doctor_licenses table for the extracted registration number.
    
    Returns:
        {"status": row['status']} or {"status": "Not Found"}
    """
    if not reg_no or not str(reg_no).strip():
        return {"status": "Not Found"}
    
    clean_reg = str(reg_no).strip()
    db_path = _get_db_path()

    if not os.path.exists(db_path):
        logger.warning(f"Database not found at {db_path}")
        return {"status": "Not Found"}

    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        # 1. Exact match attempt
        cursor.execute(
            "SELECT reg_no, doctor_name, status FROM doctor_licenses WHERE reg_no = ? COLLATE NOCASE;",
            (clean_reg,)
        )
        row = cursor.fetchone()

        # 2. If no exact match, extract digits and attempt numeric match
        if not row:
            digits = re.sub(r'[^0-9]', '', clean_reg)
            if digits:
                cursor.execute(
                    "SELECT reg_no, doctor_name, status FROM doctor_licenses WHERE reg_no = ?;",
                    (digits,)
                )
                row = cursor.fetchone()

        # 3. If still no match, try suffix/pattern match
        if not row:
            cursor.execute(
                "SELECT reg_no, doctor_name, status FROM doctor_licenses WHERE ? LIKE '%' || reg_no || '%' OR reg_no LIKE '%' || ? || '%';",
                (clean_reg, clean_reg)
            )
            row = cursor.fetchone()

        conn.close()

        if row:
            return {
                "status": row["status"],
                "doctor_name": row["doctor_name"],
                "reg_no": row["reg_no"]
            }
        else:
            return {"status": "Not Found"}

    except Exception as exc:
        logger.error(f"Error querying doctor_licenses table: {exc}")
        return {"status": "Not Found", "error": str(exc)}
