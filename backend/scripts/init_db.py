import sys
import os

# Ensure backend root is on sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from app.services.database.db import engine, Base, init_db
from app.services.database.models import User, Prescription, DrugInteraction
from sqlalchemy import inspect

def main():
    print("Initializing SQLite database tables...")
    init_db()
    
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print(f"Database successfully initialized. Registered tables: {tables}")
    
    if "users" in tables:
        columns = [col["name"] for col in inspector.get_columns("users")]
        print(f"Users table columns: {columns}")

if __name__ == "__main__":
    main()
