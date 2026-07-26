"""
SQLAlchemy ORM models for PrescriptoAI.
Tables: Users, Prescriptions, DrugInteractions
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from database.db import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship
    prescriptions = relationship("Prescription", back_populates="user")

    def __repr__(self):
        return f"<User(id={self.id}, name='{self.name}', email='{self.email}')>"


class Prescription(Base):
    __tablename__ = "prescriptions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # nullable for Phase 1 (no auth yet)
    image_url = Column(String(500), nullable=True)
    raw_text = Column(Text, nullable=True)
    structured_medicines = Column(JSON, nullable=True)  # [{name, dosage, frequency}]
    interaction_warnings = Column(JSON, nullable=True)   # [{drug_1, drug_2, severity, message}]
    status = Column(String(20), default="completed")     # pending, completed, failed
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Relationship
    user = relationship("User", back_populates="prescriptions")

    def __repr__(self):
        return f"<Prescription(id={self.id}, status='{self.status}', created='{self.created_at}')>"


class DrugInteraction(Base):
    __tablename__ = "drug_interactions"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    drug_1 = Column(String(100), nullable=False, index=True)
    drug_2 = Column(String(100), nullable=False, index=True)
    severity = Column(String(20), nullable=False)  # low, moderate, high
    warning_message = Column(Text, nullable=False)

    def __repr__(self):
        return f"<DrugInteraction('{self.drug_1}' + '{self.drug_2}' = {self.severity})>"
