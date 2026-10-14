import os
import sys
import sqlite3

def get_db_paths():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    backend_root = os.path.dirname(current_dir)
    
    # Active DB used by SQLAlchemy app
    app_db_path = os.path.join(backend_root, "app", "services", "database", "mediscan.db")
    # Backend root DB path for direct references
    root_db_path = os.path.join(backend_root, "mediscan.db")
    
    return [root_db_path, app_db_path]

DEMO_DOCTORS = [
    ("45872", "Dr. Sarah Jenkins", "Valid"),
    ("98124", "Dr. Robert Smith", "Valid"),
    ("12345", "Dr. Michael Brown", "Suspended"),
    ("77890", "Dr. Emily Watson", "Invalid"),
    ("33211", "Dr. David Wilson", "Suspended"),
    ("55443", "Dr. Jessica Taylor", "Valid"),
]

def seed_doctors_db():
    db_paths = get_db_paths()
    print("Seeding doctor licenses database...")

    for db_path in db_paths:
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        print(f"\nConnecting to SQLite database: {db_path}")
        
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # Create doctor_licenses table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS doctor_licenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reg_no TEXT UNIQUE,
            doctor_name TEXT,
            status TEXT
        );
        """)

        # Insert / Update hardcoded demo doctors
        for reg_no, doctor_name, status in DEMO_DOCTORS:
            cursor.execute("""
            INSERT INTO doctor_licenses (reg_no, doctor_name, status)
            VALUES (?, ?, ?)
            ON CONFLICT(reg_no) DO UPDATE SET
                doctor_name = excluded.doctor_name,
                status = excluded.status;
            """, (reg_no, doctor_name, status))

        conn.commit()

        # Verify insertion
        cursor.execute("SELECT id, reg_no, doctor_name, status FROM doctor_licenses;")
        rows = cursor.fetchall()
        print(f"Total doctor licenses in {os.path.basename(db_path)}: {len(rows)}")
        for r in rows:
            print(f"  - ID: {r[0]} | Reg No: {r[1]} | Doctor: {r[2]} | Status: {r[3]}")

        conn.close()

    print("\nDoctor licenses database seeded successfully!")

if __name__ == "__main__":
    seed_doctors_db()
