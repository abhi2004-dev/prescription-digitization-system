import os
import glob
import sqlite3
import pandas as pd

def get_db_paths():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    backend_root = os.path.dirname(current_dir)
    
    # Active DB used by SQLAlchemy app
    app_db_path = os.path.join(backend_root, "app", "services", "database", "mediscan.db")
    # Backend root DB path for direct references
    root_db_path = os.path.join(backend_root, "mediscan.db")
    
    return [app_db_path, root_db_path]

def init_tables(conn: sqlite3.Connection):
    cursor = conn.cursor()
    cursor.execute("DROP TABLE IF EXISTS drug_interactions;")
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS drug_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drug_1 TEXT NOT NULL,
        drug_2 TEXT NOT NULL,
        level TEXT,
        interaction TEXT
    );
    """)
    cursor.execute("""
    CREATE INDEX IF NOT EXISTS idx_drug_pair ON drug_interactions(drug_1, drug_2);
    """)
    conn.commit()

def seed_database():
    current_dir = os.path.dirname(os.path.abspath(__file__))
    backend_root = os.path.dirname(current_dir)
    data_dir = os.path.join(backend_root, "data")
    
    csv_files = glob.glob(os.path.join(data_dir, "*.csv"))
    # Process ddinter files first so specific severity levels take priority over 'Unknown'
    csv_files.sort(key=lambda x: (0 if "ddinter" in os.path.basename(x).lower() else 1, x))
    
    print(f"Found {len(csv_files)} CSV files in {data_dir}")
    for f in csv_files:
        print(f" - {os.path.basename(f)} ({os.path.getsize(f)} bytes)")

    db_paths = get_db_paths()
    primary_db = db_paths[0]
    os.makedirs(os.path.dirname(primary_db), exist_ok=True)
    
    conn = sqlite3.connect(primary_db)
    init_tables(conn)
    cursor = conn.cursor()

    total_inserted = 0
    seen_pairs = set()

    for file_path in csv_files:
        filename = os.path.basename(file_path)
        print(f"\nProcessing {filename}...")
        
        try:
            # Read CSV in chunks to keep memory usage minimal
            for chunk in pd.read_csv(file_path, chunksize=50000, dtype=str):
                # Standardize expected columns
                col_map = {c.lower(): c for c in chunk.columns}
                drug_a_col = col_map.get('drug_a', 'Drug_A')
                drug_b_col = col_map.get('drug_b', 'Drug_B')
                level_col = col_map.get('level', 'Level')
                interaction_col = col_map.get('interaction', 'interaction')

                if drug_a_col not in chunk or drug_b_col not in chunk:
                    print(f"Skipping chunk in {filename}: required columns missing")
                    continue

                records = []
                for _, row in chunk.iterrows():
                    raw_a = row.get(drug_a_col)
                    raw_b = row.get(drug_b_col)
                    
                    if pd.isna(raw_a) or pd.isna(raw_b):
                        continue
                        
                    da = str(raw_a).strip().lower()
                    db = str(raw_b).strip().lower()
                    
                    if not da or not db or da == db:
                        continue

                    # Alphabetize pair so drug_1 <= drug_2
                    d1, d2 = (da, db) if da <= db else (db, da)
                    pair_key = (d1, d2)
                    
                    if pair_key in seen_pairs:
                        continue
                    seen_pairs.add(pair_key)

                    level = str(row.get(level_col, 'Moderate')).strip() if not pd.isna(row.get(level_col)) else 'Moderate'
                    interaction = str(row.get(interaction_col, '')).strip() if not pd.isna(row.get(interaction_col)) else ''
                    
                    records.append((d1, d2, level, interaction))

                if records:
                    cursor.executemany(
                        "INSERT INTO drug_interactions (drug_1, drug_2, level, interaction) VALUES (?, ?, ?, ?);",
                        records
                    )
                    conn.commit()
                    total_inserted += len(records)
                    print(f"  Inserted batch of {len(records)} pairs (Total so far: {total_inserted})")
        except Exception as e:
            print(f"Error processing {filename}: {e}")

    conn.close()
    print(f"\nSuccessfully seeded primary database: {primary_db}")
    print(f"Total unique drug interaction pairs ingested: {total_inserted}")

    # Synchronize to root mediscan.db if distinct
    root_db = db_paths[1]
    if os.path.abspath(primary_db) != os.path.abspath(root_db):
        import shutil
        shutil.copy2(primary_db, root_db)
        print(f"Synchronized database copy to: {root_db}")

if __name__ == "__main__":
    seed_database()
