from sqlalchemy import Column, String, Integer, DateTime, Float, ForeignKey, Table
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime

class User(Base):
    __tablename__ = "users"
    
    id = Column(String, primary_key=True)
    email = Column(String, unique=True, index=True)
    name = Column(String)
    hashed_password = Column(String)
    grade_level = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    chapters = relationship("Chapter", back_populates="user")
    reading_sessions = relationship("ReadingSession", back_populates="user")

class Chapter(Base):
    __tablename__ = "chapters"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"))
    title = Column(String)
    content = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_read_at = Column(DateTime, nullable=True)
    reading_progress = Column(Float, default=0)
    
    user = relationship("User", back_populates="chapters")
    reading_sessions = relationship("ReadingSession", back_populates="chapter")

class ReadingSession(Base):
    __tablename__ = "reading_sessions"
    
    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"))
    chapter_id = Column(String, ForeignKey("chapters.id"))
    start_time = Column(DateTime, default=datetime.utcnow)
    end_time = Column(DateTime, nullable=True)
    accuracy_score = Column(Float, nullable=True)
    comprehension_score = Column(Float, nullable=True)
    words_per_minute = Column(Float, nullable=True)
    recorded_audio_url = Column(String, nullable=True)
    
    user = relationship("User", back_populates="reading_sessions")
    chapter = relationship("Chapter", back_populates="reading_sessions")