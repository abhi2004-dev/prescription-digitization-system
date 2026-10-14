import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Utilizing SQLite for the immediate milestone to eliminate external dependency overhead
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = f"sqlite:///{os.path.join(BASE_DIR, 'mediscan.db')}"

engine = create_engine(
    DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def init_db():
    # Absolute import of models ensures SQLAlchemy registers them before table creation
    from app.services.database import models
    from sqlalchemy import inspect, text
    Base.metadata.create_all(bind=engine)

    # Ensure all required columns exist on prescriptions table in existing SQLite databases
    try:
        inspector = inspect(engine)
        if "prescriptions" in inspector.get_table_names():
            existing_cols = {c["name"] for c in inspector.get_columns("prescriptions")}
            with engine.connect() as conn:
                if "user_id" not in existing_cols:
                    conn.execute(text("ALTER TABLE prescriptions ADD COLUMN user_id INTEGER;"))
                if "scanned_patient_name" not in existing_cols:
                    conn.execute(text("ALTER TABLE prescriptions ADD COLUMN scanned_patient_name TEXT;"))
                if "extracted_data" not in existing_cols:
                    conn.execute(text("ALTER TABLE prescriptions ADD COLUMN extracted_data TEXT;"))
                if "date_scanned" not in existing_cols:
                    conn.execute(text("ALTER TABLE prescriptions ADD COLUMN date_scanned DATETIME;"))
                if "filename" not in existing_cols:
                    conn.execute(text("ALTER TABLE prescriptions ADD COLUMN filename TEXT;"))
                if "extracted_text" not in existing_cols:
                    conn.execute(text("ALTER TABLE prescriptions ADD COLUMN extracted_text TEXT;"))
                if "created_at" not in existing_cols:
                    conn.execute(text("ALTER TABLE prescriptions ADD COLUMN created_at DATETIME;"))
                conn.commit()
    except Exception as e:
        print(f"Schema verification notice: {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()