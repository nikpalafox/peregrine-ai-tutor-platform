from sqlalchemy import Column, String, Integer, DateTime, Float, ForeignKey, Table, Boolean, Text
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
    is_completed = Column(Boolean, default=False)

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

class StudentStreak(Base):
    __tablename__ = "student_streaks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(String, ForeignKey("users.id"), index=True)
    streak_type = Column(String, default="daily_study")
    current_count = Column(Integer, default=0)
    max_count = Column(Integer, default=0)
    last_activity_date = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)

class StudentLevelDB(Base):
    __tablename__ = "student_levels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(String, ForeignKey("users.id"), unique=True, index=True)
    current_level = Column(Integer, default=1)
    current_xp = Column(Integer, default=0)
    xp_to_next_level = Column(Integer, default=100)
    total_xp_earned = Column(Integer, default=0)
    title = Column(String, default="Curious Beginner")

class StudentBadgeDB(Base):
    __tablename__ = "student_badges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(String, ForeignKey("users.id"), index=True)
    badge_id = Column(String, index=True)
    earned_date = Column(DateTime, default=datetime.utcnow)

class StudentStatsDB(Base):
    __tablename__ = "student_stats"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(String, ForeignKey("users.id"), unique=True, index=True)
    messages_sent = Column(Integer, default=0)
    books_read = Column(Integer, default=0)
    voice_interactions = Column(Integer, default=0)
    math_interactions = Column(Integer, default=0)
    science_interactions = Column(Integer, default=0)
    reading_interactions = Column(Integer, default=0)
    general_interactions = Column(Integer, default=0)
    stories_generated = Column(Integer, default=0)
    total_activities = Column(Integer, default=0)
    late_night_study = Column(Integer, default=0)
    early_morning_study = Column(Integer, default=0)
    total_study_time_minutes = Column(Integer, default=0)
    first_activity_date = Column(DateTime, nullable=True)
    last_activity_date = Column(DateTime, nullable=True)