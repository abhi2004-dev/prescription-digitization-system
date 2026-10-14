from sqlalchemy import Column, Integer, String, DateTime, Text
from datetime import datetime
from app.services.database.db import Base

class Prescription(Base):
    __tablename__ = "prescriptions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, index=True, nullable=True)
    scanned_patient_name = Column(Text, nullable=True)
    extracted_data = Column(Text, nullable=True)  # JSON string of full parsed payload
    date_scanned = Column(DateTime, default=datetime.utcnow)
    filename = Column(String, index=True, nullable=True, default="prescription_scan.png")
    extracted_text = Column(Text, nullable=True, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

class DrugInteraction(Base):
    __tablename__ = "drug_interactions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    drug_1 = Column(Text, index=True, nullable=False)
    drug_2 = Column(Text, index=True, nullable=False)
    level = Column(Text, nullable=True)
    interaction = Column(Text, nullable=True)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(Text, nullable=True)
    email = Column(Text, nullable=True)
    phone = Column(Text, nullable=True)
    current_conditions = Column(Text, nullable=True)  # JSON string
    active_medications = Column(Text, nullable=True)  # JSON string

class DoctorLicense(Base):
    __tablename__ = "doctor_licenses"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    reg_no = Column(Text, unique=True, index=True, nullable=False)
    doctor_name = Column(Text, nullable=True)
    status = Column(Text, nullable=True)