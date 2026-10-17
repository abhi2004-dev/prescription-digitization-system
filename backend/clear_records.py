import sqlite3
import os

# Look for the database in the known architecture locations
db_paths = [
    os.path.join("app", "services", "database", "mediscan.db"),
    "mediscan.db"
]

db_found = False
for path in db_paths:
    if os.path.exists(path):
        print(f"Found database at: {path}")
        conn = sqlite3.connect(path)
        cursor = conn.cursor()
        try:
            # Delete all rows from the prescriptions table
            cursor.execute("DELETE FROM prescriptions;")
            conn.commit()
            print("Successfully deleted all medicine/prescription records.")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            conn.close()
        
        db_found = True
        break

if not db_found:
    print("Could not locate mediscan.db. Ensure you are running this from the backend folder.")