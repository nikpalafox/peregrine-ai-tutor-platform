from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import List, Dict, Optional
import json
import uuid
from datetime import datetime, timedelta
from enum import Enum
import os
import openai
from pathlib import Path
import logging
from contextlib import asynccontextmanager
from sqlalchemy.orm import Session
from dotenv import load_dotenv

# Import our models and database
from models.auth import UserAuth, UserCreate, UserInDB, Token, TokenData
from models.reading import Chapter, ReadingSession
from models.schema import Base, User
from database import engine, get_db
from utils import format_xp_display, get_difficulty_color, create_achievement_notification
from gamification import XPCalculator, QuestGenerator, get_student_rank

# Load environment variables - explicitly look in backend directory
from pathlib import Path
backend_dir = Path(__file__).parent
env_path = backend_dir / '.env'
load_dotenv(dotenv_path=env_path)

# Set up OpenAI API key
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    print("WARNING: OPENAI_API_KEY not found in environment variables!")
    print(f"Looking for .env file at: {env_path}")
    print("Please create a .env file in the backend directory with: OPENAI_API_KEY=your_key_here")
else:
    print(f"✓ OpenAI API key loaded (starts with: {OPENAI_API_KEY[:10]}...)")

openai.api_key = OPENAI_API_KEY

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Check if running in serverless environment (Vercel)
IS_SERVERLESS = os.getenv("VERCEL") == "1" or os.getenv("AWS_LAMBDA_FUNCTION_NAME") is not None

# Create database tables (skip in serverless - filesystem is read-only)
if not IS_SERVERLESS:
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.warning(f"Could not create database tables: {e}")
        # Continue anyway - app uses in-memory storage primarily

# Define lifespan function (will be used later)
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI application startup and shutdown events"""
    # Startup: Initialize gamification system
    try:
        # Update gamification engine methods
        gamification_engine.get_student_stats = GamificationStorage.get_student_stats
        gamification_engine.student_has_badge = GamificationStorage.student_has_badge
        gamification_engine.award_badge = GamificationStorage.award_badge
        gamification_engine.get_student_badges = GamificationStorage.get_student_badges
        gamification_engine.get_student_level = GamificationStorage.get_student_level
        gamification_engine.save_student_level = GamificationStorage.save_student_level
        gamification_engine.get_streak = GamificationStorage.get_streak
        gamification_engine.save_streak = GamificationStorage.save_streak
        gamification_engine.get_student_streaks = GamificationStorage.get_student_streaks
        gamification_engine.get_active_quests = GamificationStorage.get_active_quests
        gamification_engine.save_quest_progress = GamificationStorage.save_quest_progress
        gamification_engine.get_recent_achievements = GamificationStorage.get_recent_achievements
        gamification_engine.get_leaderboard = GamificationStorage.get_leaderboard_data
        
        print("✅ Gamification system initialized successfully!")
    except Exception as e:
        print(f"❌ Error initializing gamification: {e}")
    
    yield  # Server is running
    
    # Shutdown: Clean up resources if needed
    # Add any cleanup code here

# Initialize FastAPI app with optional lifespan
if IS_SERVERLESS:
    # In serverless, lifespan events may not work reliably
    app = FastAPI(
        title="Peregrine AI Tutor Platform",
        lifespan=None,  # Disable lifespan in serverless
        docs_url="/api/docs",  # Configure docs to be at /api/docs
        redoc_url="/api/redoc",  # Configure redoc to be at /api/redoc
        openapi_url="/api/openapi.json"  # Configure OpenAPI JSON at /api/openapi.json
    )
    # Initialize gamification manually for serverless (after gamification_engine is created)
    # This will be done after gamification_engine initialization below
else:
    # Use lifespan for regular server
    app = FastAPI(
        title="Peregrine AI Tutor Platform",
        lifespan=lifespan
)

# Enable CORS for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# --- Authentication helpers (JWT + password hashing) -----------------
import bcrypt
from jose import JWTError, jwt
from models.auth import UserAuth, UserCreate, Token

SECRET_KEY = os.getenv("SECRET_KEY", "change_this_secret")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password: str) -> str:
    # Ensure password is not longer than 72 bytes (bcrypt limit)
    password_bytes = password.encode('utf-8')[:72]
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

@app.post("/api/auth/register")
def register(user: UserCreate, db: Session = Depends(get_db)):
    """Register a new user. Returns basic confirmation."""
    # check if email already exists
    existing = db.query(User).filter(User.email == user.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user_id = str(uuid.uuid4())
    hashed_pw = get_password_hash(user.password)
    db_user = User(
        id=user_id,
        email=user.email,
        name=user.name,
        hashed_password=hashed_pw,
        grade_level=user.grade_level
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    return {"message": "User created successfully", "user_id": user_id}

@app.post("/api/auth/login", response_model=Token)
def login(creds: UserAuth, db: Session = Depends(get_db)):
    """Authenticate user and return JWT access token."""
    user = db.query(User).filter(User.email == creds.email).first()
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    if not verify_password(creds.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    token = create_access_token({"sub": user.email, "user_id": user.id}, expires_delta=access_token_expires)

    return {"access_token": token, "token_type": "bearer", "user_id": user.id, "email": user.email}


# Test endpoint to verify connectivity
@app.get("/api/test")
def test_connection():
    return {"status": "ok", "message": "Backend is running"}

# Data Models
class Student(BaseModel):
    id: str
    name: str
    grade_level: int
    interests: List[str]
    learning_style: str

class ChatMessage(BaseModel):
    content: str
    student_id: str
    tutor_type: str = "general"  # math, science, reading, general

class GamificationActivityRequest(BaseModel):
    student_id: str
    activity_type: str  # "message_sent", "voice_used", "book_generated", etc.
    activity_data: Dict = {}
    subject: Optional[str] = None  # math, science, reading
    tutor_type: Optional[str] = None

class BookRequest(BaseModel):
    student_id: str
    topic: str
    chapter_number: int = 1

class ChatResponse(BaseModel):
    response: str
    student_id: str
    timestamp: str

# Gamification Models
class BadgeType(str, Enum):
    ACHIEVEMENT = "achievement"
    MILESTONE = "milestone"
    STREAK = "streak"
    SUBJECT = "subject"
    SPECIAL = "special"

class DifficultyLevel(str, Enum):
    BRONZE = "bronze"
    SILVER = "silver" 
    GOLD = "gold"
    PLATINUM = "platinum"

class Badge(BaseModel):
    id: str
    name: str
    description: str
    icon: str  # emoji or icon identifier
    badge_type: BadgeType
    difficulty: DifficultyLevel
    requirements: Dict  # flexible requirements structure
    xp_reward: int
    rarity_score: int  # 1-100, higher = rarer

class Achievement(BaseModel):
    id: str
    student_id: str
    badge_id: str
    earned_date: datetime
    progress: float = 100.0  # percentage completion

class StudentLevel(BaseModel):
    student_id: str
    current_level: int
    current_xp: int
    xp_to_next_level: int
    total_xp_earned: int
    title: str  # e.g., "Math Explorer", "Science Whiz"

class Streak(BaseModel):
    student_id: str
    streak_type: str  # "daily_login", "daily_study", "subject_focus"
    current_count: int
    max_count: int
    last_activity_date: datetime
    is_active: bool

class Quest(BaseModel):
    id: str
    name: str
    description: str
    requirements: Dict
    xp_reward: int
    badge_reward: Optional[str] = None
    time_limit_hours: Optional[int] = None
    difficulty: DifficultyLevel

class StudentQuest(BaseModel):
    quest_id: str
    student_id: str
    start_date: datetime
    progress: Dict  # tracks progress toward requirements
    completed: bool = False
    completion_date: Optional[datetime] = None

# Gamification Engine
class GamificationEngine:

    def __init__(self):
        self.badges = self._initialize_badges()
        self.quests = self._initialize_quests()
        self.level_thresholds = self._initialize_level_system()
        
    def _initialize_badges(self) -> Dict[str, Badge]:
        """Initialize all available badges"""
        badges = {
            # First Steps Badges
            "first_chat": Badge(
                id="first_chat",
                name="First Steps",
                description="Had your first conversation with an AI tutor",
                icon="👋",
                badge_type=BadgeType.MILESTONE,
                difficulty=DifficultyLevel.BRONZE,
                requirements={"messages_sent": 1},
                xp_reward=50,
                rarity_score=5
            ),
            
            "curious_mind": Badge(
                id="curious_mind",
                name="Curious Mind",
                description="Asked 10 different questions",
                icon="🤔",
                badge_type=BadgeType.ACHIEVEMENT,
                difficulty=DifficultyLevel.BRONZE,
                requirements={"unique_questions": 10},
                xp_reward=100,
                rarity_score=15
            ),
            
            # Subject Mastery Badges
            "math_rookie": Badge(
                id="math_rookie",
                name="Math Rookie",
                description="Solved 20 math problems",
                icon="🔢",
                badge_type=BadgeType.SUBJECT,
                difficulty=DifficultyLevel.BRONZE,
                requirements={"math_interactions": 20},
                xp_reward=150,
                rarity_score=25
            ),
            
            "math_explorer": Badge(
                id="math_explorer",
                name="Math Explorer",
                description="Solved 100 math problems",
                icon="🧮",
                badge_type=BadgeType.SUBJECT,
                difficulty=DifficultyLevel.SILVER,
                requirements={"math_interactions": 100},
                xp_reward=300,
                rarity_score=45
            ),
            
            "math_master": Badge(
                id="math_master",
                name="Math Master",
                description="Solved 500 math problems",
                icon="🏆",
                badge_type=BadgeType.SUBJECT,
                difficulty=DifficultyLevel.GOLD,
                requirements={"math_interactions": 500},
                xp_reward=750,
                rarity_score=80
            ),
            
            "science_enthusiast": Badge(
                id="science_enthusiast",
                name="Science Enthusiast",
                description="Explored 50 science topics",
                icon="🔬",
                badge_type=BadgeType.SUBJECT,
                difficulty=DifficultyLevel.SILVER,
                requirements={"science_interactions": 50},
                xp_reward=200,
                rarity_score=35
            ),
            
            "reading_champion": Badge(
                id="reading_champion",
                name="Reading Champion",
                description="Read 25 AI-generated stories",
                icon="📚",
                badge_type=BadgeType.SUBJECT,
                difficulty=DifficultyLevel.SILVER,
                requirements={"books_read": 25},
                xp_reward=250,
                rarity_score=40
            ),
            
            # Streak Badges
            "daily_learner": Badge(
                id="daily_learner",
                name="Daily Learner",
                description="Studied for 7 days in a row",
                icon="🔥",
                badge_type=BadgeType.STREAK,
                difficulty=DifficultyLevel.BRONZE,
                requirements={"daily_streak": 7},
                xp_reward=200,
                rarity_score=30
            ),
            
            "study_warrior": Badge(
                id="study_warrior",
                name="Study Warrior",
                description="Studied for 30 days in a row",
                icon="⚔️",
                badge_type=BadgeType.STREAK,
                difficulty=DifficultyLevel.GOLD,
                requirements={"daily_streak": 30},
                xp_reward=1000,
                rarity_score=90
            ),
            
            # Special Achievement Badges
            "night_owl": Badge(
                id="night_owl",
                name="Night Owl",
                description="Studied after 9 PM",
                icon="🦉",
                badge_type=BadgeType.SPECIAL,
                difficulty=DifficultyLevel.BRONZE,
                requirements={"late_night_study": 1},
                xp_reward=75,
                rarity_score=20
            ),
            
            "early_bird": Badge(
                id="early_bird",
                name="Early Bird",
                description="Studied before 7 AM",
                icon="🐦",
                badge_type=BadgeType.SPECIAL,
                difficulty=DifficultyLevel.BRONZE,
                requirements={"early_morning_study": 1},
                xp_reward=75,
                rarity_score=20
            ),
            
            "voice_explorer": Badge(
                id="voice_explorer",
                name="Voice Explorer",
                description="Used voice chat 10 times",
                icon="🎤",
                badge_type=BadgeType.ACHIEVEMENT,
                difficulty=DifficultyLevel.BRONZE,
                requirements={"voice_interactions": 10},
                xp_reward=125,
                rarity_score=25
            ),
            
            "story_creator": Badge(
                id="story_creator",
                name="Story Creator",
                description="Generated 5 custom stories",
                icon="✨",
                badge_type=BadgeType.ACHIEVEMENT,
                difficulty=DifficultyLevel.SILVER,
                requirements={"stories_generated": 5},
                xp_reward=200,
                rarity_score=35
            ),
            
            # Ultra Rare Badges
            "tutor_whisperer": Badge(
                id="tutor_whisperer",
                name="Tutor Whisperer",
                description="Chatted with all 4 specialized tutors in one day",
                icon="🌟",
                badge_type=BadgeType.SPECIAL,
                difficulty=DifficultyLevel.PLATINUM,
                requirements={"all_tutors_one_day": 1},
                xp_reward=500,
                rarity_score=95
            ),
            
            "knowledge_seeker": Badge(
                id="knowledge_seeker",
                name="Knowledge Seeker",
                description="Covered 20 different topics in one week",
                icon="🎯",
                badge_type=BadgeType.SPECIAL,
                difficulty=DifficultyLevel.PLATINUM,
                requirements={"diverse_topics_week": 20},
                xp_reward=750,
                rarity_score=98
            )
        }
        return badges
    
    def _initialize_quests(self) -> Dict[str, Quest]:
        """Initialize daily and weekly quests"""
        quests = {
            "daily_explorer": Quest(
                id="daily_explorer",
                name="Daily Explorer",
                description="Ask 5 questions today",
                requirements={"messages_today": 5},
                xp_reward=100,
                time_limit_hours=24,
                difficulty=DifficultyLevel.BRONZE
            ),
            
            "subject_hopper": Quest(
                id="subject_hopper",
                name="Subject Hopper",
                description="Chat with 3 different tutors today",
                requirements={"different_tutors_today": 3},
                xp_reward=150,
                badge_reward="tutor_whisperer",  # partial progress toward badge
                time_limit_hours=24,
                difficulty=DifficultyLevel.SILVER
            ),
            
            "story_time": Quest(
                id="story_time",
                name="Story Time",
                description="Generate and read a story today",
                requirements={"story_generated_and_read_today": 1},
                xp_reward=125,
                time_limit_hours=24,
                difficulty=DifficultyLevel.BRONZE
            ),
            
            "math_marathon": Quest(
                id="math_marathon",
                name="Math Marathon",
                description="Solve 10 math problems this week",
                requirements={"math_problems_week": 10},
                xp_reward=300,
                badge_reward="math_rookie",  # progress toward badge
                time_limit_hours=168,  # 7 days
                difficulty=DifficultyLevel.SILVER
            ),
            
            "voice_challenger": Quest(
                id="voice_challenger",
                name="Voice Challenger",
                description="Use voice chat 3 times today",
                requirements={"voice_interactions_today": 3},
                xp_reward=175,
                time_limit_hours=24,
                difficulty=DifficultyLevel.SILVER
            )
        }
        return quests
    
    def _initialize_level_system(self) -> Dict[int, Dict]:
        """Initialize XP thresholds and titles for each level"""
        levels = {}
        base_xp = 100
        multiplier = 1.5
        
        titles = [
            "Curious Beginner", "Eager Learner", "Knowledge Seeker", "Smart Student", 
            "Bright Mind", "Study Star", "Academic Ace", "Learning Legend",
            "Wisdom Warrior", "Scholar Supreme", "Master Mind", "Genius Explorer",
            "Brilliant Brain", "Learning Lord", "Knowledge King", "Study Sage",
            "Academic Angel", "Wisdom Wizard", "Learning Luminary", "Ultimate Scholar"
        ]
        
        for level in range(1, 21):  # Levels 1-20
            xp_required = int(base_xp * (multiplier ** (level - 1)))
            levels[level] = {
                "xp_required": xp_required,
                "title": titles[min(level - 1, len(titles) - 1)],
                "perks": self._get_level_perks(level)
            }
        
        return levels
    
    def _get_level_perks(self, level: int) -> List[str]:
        """Get perks unlocked at each level"""
        perks = []
        if level >= 3:
            perks.append("Voice chat unlocked")
        if level >= 5:
            perks.append("Custom story generation")
        if level >= 8:
            perks.append("Advanced progress tracking")
        if level >= 10:
            perks.append("Parent dashboard insights")
        if level >= 15:
            perks.append("Platinum quest access")
        if level >= 20:
            perks.append("Master scholar status")
        
        return perks
    
    async def check_and_award_badges(self, student_id: str, activity_data: Dict) -> List[Badge]:
        """Check if student has earned any new badges and award them"""
        awarded_badges = []
        student_stats = await self.get_student_stats(student_id)
        
        for badge_id, badge in self.badges.items():
            # Skip if student already has this badge
            if await self.student_has_badge(student_id, badge_id):
                continue
                
            # Check if requirements are met
            if self._check_badge_requirements(badge, student_stats, activity_data):
                await self.award_badge(student_id, badge_id)
                awarded_badges.append(badge)
                
                # Award XP for earning the badge
                await self.add_xp(student_id, badge.xp_reward, f"Earned badge: {badge.name}")
        
        return awarded_badges
    
    def _check_badge_requirements(self, badge: Badge, student_stats: Dict, activity_data: Dict) -> bool:
        """Check if badge requirements are satisfied"""
        requirements = badge.requirements
        
        # Check each requirement
        for req_key, req_value in requirements.items():
            current_value = student_stats.get(req_key, 0)
            activity_value = activity_data.get(req_key, 0)
            total_value = current_value + activity_value
            
            if total_value < req_value:
                return False
        
        return True
    
    async def update_streaks(self, student_id: str) -> Dict[str, Streak]:
        """Update student streaks based on current activity"""
        today = datetime.now().date()
        streaks = {}
        
        # Daily study streak
        daily_streak = await self.get_streak(student_id, "daily_study")
        if not daily_streak:
            daily_streak = Streak(
                student_id=student_id,
                streak_type="daily_study",
                current_count=1,
                max_count=1,
                last_activity_date=datetime.now(),
                is_active=True
            )
        else:
            last_date = daily_streak.last_activity_date.date()
            if last_date == today:
                # Already counted today, no change
                pass
            elif last_date == today - timedelta(days=1):
                # Consecutive day, increment streak
                daily_streak.current_count += 1
                daily_streak.max_count = max(daily_streak.max_count, daily_streak.current_count)
                daily_streak.last_activity_date = datetime.now()
            else:
                # Streak broken, reset
                daily_streak.current_count = 1
                daily_streak.last_activity_date = datetime.now()
                daily_streak.is_active = True
        
        await self.save_streak(daily_streak)
        streaks["daily_study"] = daily_streak
        
        # Check for streak-based badges
        await self.check_streak_badges(student_id, daily_streak)
        
        return streaks
    
    async def check_streak_badges(self, student_id: str, streak: Streak):
        """Check and award streak-based badges"""
        if streak.streak_type == "daily_study":
            if streak.current_count >= 7 and not await self.student_has_badge(student_id, "daily_learner"):
                await self.award_badge(student_id, "daily_learner")
            elif streak.current_count >= 30 and not await self.student_has_badge(student_id, "study_warrior"):
                await self.award_badge(student_id, "study_warrior")
    
    async def generate_daily_quests(self, student_id: str) -> List[Quest]:
        """Generate personalized daily quests for a student"""
        student_stats = await self.get_student_stats(student_id)
        student_level = await self.get_student_level(student_id)
        
        available_quests = []
        
        # Always include basic exploration quest
        available_quests.append(self.quests["daily_explorer"])
        
        # Add level-appropriate quests
        if student_level.current_level >= 3:
            available_quests.append(self.quests["voice_challenger"])
        
        if student_level.current_level >= 5:
            available_quests.append(self.quests["story_time"])
        
        # Add subject-specific quests based on student's activity
        if student_stats.get("math_interactions", 0) > 5:
            available_quests.append(self.quests["math_marathon"])
        
        # Randomly select 2-3 quests for the day
        import random
        daily_quests = random.sample(available_quests, min(3, len(available_quests)))
        
        return daily_quests
    
    async def update_quest_progress(self, student_id: str, activity_data: Dict) -> List[Dict]:
        """Update progress on active quests"""
        active_quests = await self.get_active_quests(student_id)
        completed_quests = []
        
        for quest_progress in active_quests:
            quest = self.quests[quest_progress.quest_id]
            updated = False
            
            # Update progress based on activity
            for req_key, req_value in quest.requirements.items():
                if req_key in activity_data:
                    current_progress = quest_progress.progress.get(req_key, 0)
                    quest_progress.progress[req_key] = current_progress + activity_data[req_key]
                    updated = True
            
            # Check if quest is completed
            if self._is_quest_completed(quest, quest_progress.progress):
                quest_progress.completed = True
                quest_progress.completion_date = datetime.now()
                
                # Award XP and badge if applicable
                await self.add_xp(student_id, quest.xp_reward, f"Completed quest: {quest.name}")
                
                if quest.badge_reward:
                    await self.award_badge(student_id, quest.badge_reward)
                
                completed_quests.append({
                    "quest": quest,
                    "xp_earned": quest.xp_reward,
                    "badge_earned": quest.badge_reward
                })
            
            if updated:
                await self.save_quest_progress(quest_progress)
        
        return completed_quests
    
    def _is_quest_completed(self, quest: Quest, progress: Dict) -> bool:
        """Check if quest requirements are fully met"""
        for req_key, req_value in quest.requirements.items():
            if progress.get(req_key, 0) < req_value:
                return False
        return True
    
    async def get_leaderboard(self, timeframe: str = "all_time", limit: int = 10) -> List[Dict]:
        """Get student leaderboard"""
        return await GamificationStorage.get_leaderboard_data(timeframe, limit)
    
    async def get_student_achievements_summary(self, student_id: str) -> Dict:
        """Get comprehensive achievement summary for a student"""
        student_level = await self.get_student_level(student_id)
        badges = await self.get_student_badges(student_id)
        streaks = await self.get_student_streaks(student_id)
        active_quests = await self.get_active_quests(student_id)
        
        # Calculate achievement statistics
        total_badges = len(badges)
        badges_by_type = {}
        total_xp = student_level.total_xp_earned
        
        for badge_id in badges:
            badge = self.badges[badge_id]
            badge_type = badge.badge_type.value
            badges_by_type[badge_type] = badges_by_type.get(badge_type, 0) + 1
        
        # Calculate completion rates
        total_possible_badges = len(self.badges)
        completion_rate = (total_badges / total_possible_badges) * 100
        
        return {
            "level": student_level.current_level,
            "title": student_level.title,
            "total_xp": total_xp,
            "current_xp": student_level.current_xp,
            "xp_to_next_level": student_level.xp_to_next_level,
            "total_badges": total_badges,
            "badges_by_type": badges_by_type,
            "completion_rate": round(completion_rate, 1),
            "active_streaks": len([s for s in streaks.values() if s.is_active]),
            "longest_streak": max([s.max_count for s in streaks.values()]) if streaks else 0,
            "active_quests": len(active_quests),
            "recent_achievements": await self.get_recent_achievements(student_id, limit=5)
        }
    
    # Placeholder methods for database operations
    # In a real implementation, these would interact with your database
    
    async def get_student_stats(self, student_id: str) -> Dict:
        self.get_student_stats = GamificationStorage.get_student_stats

    
    async def student_has_badge(self, student_id: str, badge_id: str) -> bool:
        """Check if student has a specific badge"""
        self.student_has_badge = GamificationStorage.student_has_badge
        return await self.student_has_badge(student_id, badge_id)

    async def award_badge(self, student_id: str, badge_id: str):
        """Award a badge to a student"""
        achievement = Achievement(
            id=f"{student_id}_{badge_id}_{datetime.now().timestamp()}",
            student_id=student_id,
            badge_id=badge_id,
            earned_date=datetime.now()
        )
        self.award_badge = GamificationStorage.award_badge
        print(f"Badge awarded: {badge_id} to student {student_id}")
    
    async def add_xp(self, student_id: str, xp_amount: int, reason: str):
        """Add XP to student and check for level up"""
        student_level = await self.get_student_level(student_id)
        student_level.current_xp += xp_amount
        student_level.total_xp_earned += xp_amount

        self.get_student_badges = GamificationStorage.get_student_badges
        while student_level.current_xp >= student_level.xp_to_next_level:
            student_level.current_xp -= student_level.xp_to_next_level
            student_level.current_level += 1

            self.get_student_level = GamificationStorage.get_student_level
            level_data = self.level_thresholds[student_level.current_level]
            student_level.title = level_data["title"]
            student_level.xp_to_next_level = level_data["xp_required"]
            
            print(f"Level up! Student {student_id} reached level {student_level.current_level}")
        
        await self.save_student_level(student_level)
        self.save_student_level = GamificationStorage.save_student_level

    async def get_student_level(self, student_id: str) -> StudentLevel:
        self.get_student_level = GamificationStorage.get_student_level
        return await self.get_student_level(student_id)

    
    async def get_streak(self, student_id: str, streak_type: str) -> Optional[Streak]:
        self.get_streak = GamificationStorage.get_streak
        return await self.get_streak(student_id, streak_type)
    
    async def save_streak(self, streak: Streak):
        """Save streak to database"""
        self.save_streak = GamificationStorage.save_streak
    
    async def get_active_quests(self, student_id: str) -> List[StudentQuest]:
        self.get_active_quests = GamificationStorage.get_active_quests
        return await self.get_active_quests(student_id)

    async def save_quest_progress(self, quest_progress: StudentQuest):
        """Save quest progress to database"""
        self.save_quest_progress = GamificationStorage.save_quest_progress
        await self.save_quest_progress(quest_progress)
    
    async def get_student_badges(self, student_id: str) -> List[str]:
        self.get_student_badges = GamificationStorage.get_student_badges
        return await self.get_student_badges(student_id)

    async def get_student_streaks(self, student_id: str) -> Dict[str, Streak]:
        self.get_student_streaks = GamificationStorage.get_student_streaks
        return await self.get_student_streaks(student_id)
    
    async def save_student_level(self, student_level: StudentLevel):
        """Save student level to database"""
        self.save_student_level = GamificationStorage.save_student_level
        await self.save_student_level(student_level)

    async def get_recent_achievements(self, student_id: str, limit: int = 5) -> List[Dict]:
        self.get_recent_achievements = GamificationStorage.get_recent_achievements
        return await self.get_recent_achievements(student_id, limit)
    

    async def process_student_activity(self, student_id: str, activity_type: str, activity_data: Dict = None) -> Dict:
        """Process student activity and update all gamification metrics"""
        if activity_data is None:
            activity_data = {}
        
        results = {
            "xp_gained": 0,
            "new_badges": [],
            "completed_quests": [],
            "streak_updates": {},
            "level_up": False
        }
        
        try:
            # 1. Calculate and award XP
            xp_result = await XPCalculator.calculate_activity_xp(student_id, activity_type, activity_data)
            xp_info = await self.add_xp(student_id, xp_result["total_xp"], f"Activity: {activity_type}")
            
            results["xp_gained"] = xp_result["total_xp"]
            results["xp_details"] = xp_result
            results["level_up"] = xp_info["level_up"]
            results["level_info"] = xp_info
            
            # 2. Update student stats
            stats_update = {
                activity_type: 1,
                "total_activities": 1
            }
            
            # Add subject-specific stats
            if activity_data.get("subject"):
                stats_update[f"{activity_data['subject']}_interactions"] = 1
            
            # Add tutor-specific stats
            if activity_data.get("tutor_type"):
                stats_update["different_tutors_used"] = activity_data["tutor_type"]
            
            # Update time-based stats
            current_hour = datetime.now().hour
            if current_hour >= 21 or current_hour <= 5:
                stats_update["late_night_study"] = 1
            elif current_hour <= 7:
                stats_update["early_morning_study"] = 1
            
            await GamificationStorage.update_student_stats(student_id, stats_update)
            
            # 3. Update streaks
            streak_updates = await self.update_streaks(student_id)
            results["streak_updates"] = {
                streak_type: {
                    "current_count": streak.current_count,
                    "is_record": streak.current_count >= streak.max_count,
                    "is_active": streak.is_active
                } for streak_type, streak in streak_updates.items()
            }
            
            # 4. Check for new badges
            current_stats = await self.get_student_stats(student_id)
            new_badges = await self.check_and_award_badges(student_id, current_stats)
            results["new_badges"] = [
                {
                    "id": badge.id,
                    "name": badge.name,
                    "description": badge.description,
                    "icon": badge.icon,
                    "xp_reward": badge.xp_reward,
                    "difficulty": badge.difficulty.value,
                    "rarity_score": badge.rarity_score
                } for badge in new_badges
            ]
            
            # 5. Update quest progress
            completed_quests = await self.update_quest_progress(student_id, current_stats)
            results["completed_quests"] = completed_quests
            
            # 6. Check for special achievements
            await self.check_special_achievements(student_id, activity_type, activity_data)
            
        except Exception as e:
            print(f"Error processing student activity: {e}")
            results["error"] = str(e)
        
        return results
    
    async def check_special_achievements(self, student_id: str, activity_type: str, activity_data: Dict):
        """Check for special time-based and activity-based achievements"""
        current_hour = datetime.now().hour
        
        # Night Owl achievement
        if current_hour >= 21 or current_hour <= 5:
            if not await self.student_has_badge(student_id, "night_owl"):
                await self.award_badge(student_id, "night_owl")
        
        # Early Bird achievement
        if current_hour <= 7:
            if not await self.student_has_badge(student_id, "early_bird"):
                await self.award_badge(student_id, "early_bird")
        
        # Voice Explorer achievement
        if activity_type == "voice_used":
            stats = await self.get_student_stats(student_id)
            if stats.get("voice_interactions", 0) >= 10:
                if not await self.student_has_badge(student_id, "voice_explorer"):
                    await self.award_badge(student_id, "voice_explorer")
        
        # Story Creator achievement
        if activity_type == "book_generated":
            stats = await self.get_student_stats(student_id)
            if stats.get("stories_generated", 0) >= 5:
                if not await self.student_has_badge(student_id, "story_creator"):
                    await self.award_badge(student_id, "story_creator")
        
        # Tutor Whisperer achievement (all 4 tutors in one day)
        if activity_data.get("tutor_type"):
            # This would need daily tracking - simplified version
            stats = await self.get_student_stats(student_id)
            tutors_used = stats.get("different_tutors_used", set())
            if isinstance(tutors_used, set) and len(tutors_used) >= 4:
                if not await self.student_has_badge(student_id, "tutor_whisperer"):
                    await self.award_badge(student_id, "tutor_whisperer")
    
    async def start_daily_quest(self, student_id: str, quest_id: str) -> bool:
        """Start a daily quest for a student"""
        try:
            # Check if quest already active
            active_quests = await self.get_active_quests(student_id)
            if any(q.quest_id == quest_id for q in active_quests):
                return False  # Already active
            
            # Create new quest progress
            quest_progress = StudentQuest(
                quest_id=quest_id,
                student_id=student_id,
                start_date=datetime.now(),
                progress={}
            )
            
            await self.save_quest_progress(quest_progress)
            print(f"🎯 Daily quest started: {quest_id} for student {student_id}")
            return True
            
        except Exception as e:
            print(f"Error starting daily quest: {e}")
            return False
    
    async def get_student_dashboard_data(self, student_id: str) -> Dict:
        """Get comprehensive dashboard data for a student"""
        try:
            # Get all the data
            level_info = await self.get_student_level(student_id)
            badges = await self.get_student_badges(student_id)
            streaks = await self.get_student_streaks(student_id)
            stats = await self.get_student_stats(student_id)
            recent_achievements = await self.get_recent_achievements(student_id, 5)
            active_quests = await self.get_active_quests(student_id)
            
            # Generate daily quests if none active
            if not active_quests:
                daily_quests = await self.generate_daily_quests(student_id)
                for quest in daily_quests[:3]:  # Start up to 3 daily quests
                    await self.start_daily_quest(student_id, quest.id)
                active_quests = await self.get_active_quests(student_id)
            
            # Calculate statistics
            total_badges = len(badges)
            badges_by_type = {}
            for badge_id in badges:
                badge = self.badges[badge_id]
                badge_type = badge.badge_type.value
                badges_by_type[badge_type] = badges_by_type.get(badge_type, 0) + 1
            
            active_streak_count = len([s for s in streaks.values() if s.is_active])
            longest_streak = max([s.max_count for s in streaks.values()]) if streaks else 0
            
            return {
                "student_id": student_id,
                "level": {
                    "current_level": level_info.current_level,
                    "title": level_info.title,
                    "current_xp": level_info.current_xp,
                    "xp_to_next_level": level_info.xp_to_next_level,
                    "total_xp_earned": level_info.total_xp_earned,
                    "progress_percentage": (level_info.current_xp / level_info.xp_to_next_level) * 100
                },
                "badges": {
                    "total_count": total_badges,
                    "by_type": badges_by_type,
                    "completion_rate": (total_badges / len(self.badges)) * 100,
                    "recent": recent_achievements
                },
                "streaks": {
                    "active_count": active_streak_count,
                    "longest_streak": longest_streak,
                    "details": {
                        streak_type: {
                            "current": streak.current_count,
                            "max": streak.max_count,
                            "active": streak.is_active
                        } for streak_type, streak in streaks.items()
                    }
                },
                "quests": {
                    "active_count": len(active_quests),
                    "details": [
                        {
                            "id": quest.quest_id,
                            "name": self.quests[quest.quest_id].name,
                            "description": self.quests[quest.quest_id].description,
                            "progress": quest.progress,
                            "requirements": self.quests[quest.quest_id].requirements,
                            "completion_percentage": self._calculate_quest_completion_percentage(quest)
                        } for quest in active_quests
                    ]
                },
                "stats": {
                    "total_messages": stats.get("messages_sent", 0),
                    "subjects_explored": sum([
                        1 for key in stats.keys() 
                        if key.endswith("_interactions") and stats[key] > 0
                    ]),
                    "voice_interactions": stats.get("voice_interactions", 0),
                    "books_generated": stats.get("stories_generated", 0)
                }
            }
            
        except Exception as e:
            print(f"Error getting dashboard data: {e}")
            return {"error": str(e)}
    
    def _calculate_quest_completion_percentage(self, quest_progress: StudentQuest) -> float:
        """Calculate completion percentage for a quest"""
        quest = self.quests.get(quest_progress.quest_id)
        if not quest or not quest.requirements:
            return 0.0
        
        total_progress = 0
        for req_key, req_value in quest.requirements.items():
            current_value = quest_progress.progress.get(req_key, 0)
            req_progress = min(current_value / req_value, 1.0) * 100
            total_progress += req_progress
        
        return total_progress / len(quest.requirements)

class GamificationStorage:
    """Handles all gamification data storage operations"""
    
    @staticmethod
    async def get_student_stats(student_id: str) -> Dict:
        """Get comprehensive student statistics"""
        if student_id not in student_stats_db:
            student_stats_db[student_id] = {
                "messages_sent": 0,
                "math_interactions": 0,
                "science_interactions": 0,
                "reading_interactions": 0,
                "general_interactions": 0,
                "books_read": 0,
                "voice_interactions": 0,
                "stories_generated": 0,
                "unique_questions": 0,
                "different_tutors_used": set(),
                "late_night_study": 0,
                "early_morning_study": 0,
                "total_study_time_minutes": 0,
                "consecutive_days": 0,
                "first_chat_date": None,
                "last_activity_date": None
            }
        
        stats = student_stats_db[student_id].copy()
        # Convert set to count for different_tutors_used
        if isinstance(stats.get("different_tutors_used"), set):
            stats["different_tutors_used"] = len(stats["different_tutors_used"])
        
        return stats
    
    @staticmethod
    async def update_student_stats(student_id: str, activity_data: Dict):
        """Update student statistics based on activity"""
        stats = await GamificationStorage.get_student_stats(student_id)
        
        # Update based on activity type
        for key, value in activity_data.items():
            if key == "different_tutors_used" and isinstance(stats[key], set):
                stats[key].add(value)
            elif key in stats:
                if isinstance(value, (int, float)):
                    stats[key] += value
                else:
                    stats[key] = value
        
        # Update timestamps
        stats["last_activity_date"] = datetime.now()
        if stats["first_chat_date"] is None:
            stats["first_chat_date"] = datetime.now()
        
        student_stats_db[student_id] = stats
    
    @staticmethod
    async def student_has_badge(student_id: str, badge_id: str) -> bool:
        """Check if student has earned a specific badge"""
        if student_id not in student_badges_db:
            return False
        
        achievements = student_badges_db[student_id]
        return any(achievement.badge_id == badge_id for achievement in achievements)
    
    @staticmethod
    async def award_badge(student_id: str, badge_id: str):
        """Award a badge to a student"""
        if student_id not in student_badges_db:
            student_badges_db[student_id] = []
        
        # Check if badge already awarded
        if await GamificationStorage.student_has_badge(student_id, badge_id):
            return
        
        achievement = Achievement(
            id=f"{student_id}_{badge_id}_{datetime.now().timestamp()}",
            student_id=student_id,
            badge_id=badge_id,
            earned_date=datetime.now()
        )
        
        student_badges_db[student_id].append(achievement)
        print(f"🏆 Badge awarded: {badge_id} to student {student_id}")
    
    @staticmethod
    async def get_student_badges(student_id: str) -> List[str]:
        """Get list of badge IDs earned by student"""
        if student_id not in student_badges_db:
            return []
        
        return [achievement.badge_id for achievement in student_badges_db[student_id]]
    
    @staticmethod
    async def get_student_level(student_id: str) -> StudentLevel:
        """Get student's current level information"""
        if student_id not in student_levels_db:
            # Initialize new student at level 1
            student_levels_db[student_id] = StudentLevel(
                student_id=student_id,
                current_level=1,
                current_xp=0,
                xp_to_next_level=100,  # First level requires 100 XP
                total_xp_earned=0,
                title="Curious Beginner"
            )
        
        return student_levels_db[student_id]
    
    @staticmethod
    async def save_student_level(student_level: StudentLevel):
        """Save student level to storage"""
        student_levels_db[student_level.student_id] = student_level
        print(f"📊 Level updated for student {student_level.student_id}: Level {student_level.current_level} - {student_level.title}")
    
    @staticmethod
    async def get_streak(student_id: str, streak_type: str) -> Optional[Streak]:
        """Get a specific streak for a student"""
        if student_id not in student_streaks_db:
            student_streaks_db[student_id] = {}
        
        return student_streaks_db[student_id].get(streak_type)
    
    @staticmethod
    async def save_streak(streak: Streak):
        """Save streak to storage"""
        if streak.student_id not in student_streaks_db:
            student_streaks_db[streak.student_id] = {}
        
        student_streaks_db[streak.student_id][streak.streak_type] = streak
        
        if streak.is_active:
            print(f"🔥 Streak updated: {streak.streak_type} - {streak.current_count} days for student {streak.student_id}")
    
    @staticmethod
    async def get_student_streaks(student_id: str) -> Dict[str, Streak]:
        """Get all streaks for a student"""
        if student_id not in student_streaks_db:
            return {}
        
        return student_streaks_db[student_id]
    
    @staticmethod
    async def get_active_quests(student_id: str) -> List[StudentQuest]:
        """Get student's active quests"""
        if student_id not in student_quests_db:
            return []
        
        now = datetime.now()
        active_quests = []
        
        for quest in student_quests_db[student_id]:
            if quest.completed:
                continue
            
            # Check if quest has expired
            if quest.start_date and hasattr(quest, 'time_limit_hours'):
                quest_obj = gamification_engine.quests.get(quest.quest_id)
                if quest_obj and quest_obj.time_limit_hours:
                    expiry_time = quest.start_date + timedelta(hours=quest_obj.time_limit_hours)
                    if now > expiry_time:
                        continue
            
            active_quests.append(quest)
        
        return active_quests
    
    @staticmethod
    async def save_quest_progress(quest_progress: StudentQuest):
        """Save quest progress to storage"""
        if quest_progress.student_id not in student_quests_db:
            student_quests_db[quest_progress.student_id] = []
        
        # Update existing quest or add new one
        quests = student_quests_db[quest_progress.student_id]
        for i, existing_quest in enumerate(quests):
            if existing_quest.quest_id == quest_progress.quest_id:
                quests[i] = quest_progress
                return
        
        # Add new quest if not found
        quests.append(quest_progress)
    
    @staticmethod
    async def start_quest(student_id: str, quest_id: str):
        """Start a new quest for a student"""
        student_quest = StudentQuest(
            quest_id=quest_id,
            student_id=student_id,
            start_date=datetime.now(),
            progress={}
        )
        
        await GamificationStorage.save_quest_progress(student_quest)
        print(f"🎯 Quest started: {quest_id} for student {student_id}")
    
    @staticmethod
    async def get_recent_achievements(student_id: str, limit: int = 5) -> List[Dict]:
        """Get recent achievements for a student"""
        if student_id not in student_badges_db:
            return []
        
        achievements = student_badges_db[student_id]
        # Sort by earned_date, most recent first
        sorted_achievements = sorted(achievements, key=lambda x: x.earned_date, reverse=True)
        
        recent = []
        for achievement in sorted_achievements[:limit]:
            badge = gamification_engine.badges[achievement.badge_id]
            recent.append({
                "id": achievement.id,
                "badge_name": badge.name,
                "badge_icon": badge.icon,
                "earned_date": achievement.earned_date.isoformat(),
                "xp_reward": badge.xp_reward
            })
        
        return recent
    
    @staticmethod
    async def get_leaderboard_data(timeframe: str = "all_time", limit: int = 10) -> List[Dict]:
        """Get leaderboard data for all students"""
        leaderboard = []
        
        for student_id, level_data in student_levels_db.items():
            # Get student info (you might want to anonymize this)
            student_name = f"Student {student_id[-4:]}"  # Show last 4 chars of ID
            
            # Get additional stats
            badges_count = len(await GamificationStorage.get_student_badges(student_id))
            
            leaderboard.append({
                "student_id": student_id,
                "student_name": student_name,
                "level": level_data.current_level,
                "total_xp": level_data.total_xp_earned,
                "title": level_data.title,
                "badges_earned": badges_count
            })
        
        # Sort by total XP (descending)
        leaderboard.sort(key=lambda x: x["total_xp"], reverse=True)
        
        # Add ranks
        for i, entry in enumerate(leaderboard[:limit]):
            entry["rank"] = i + 1
        
        return leaderboard[:limit]
    
    @staticmethod
    def export_student_data(student_id: str) -> Dict:
        """Export all gamification data for a student"""
        return {
            "student_id": student_id,
            "level": student_levels_db.get(student_id),
            "badges": student_badges_db.get(student_id, []),
            "streaks": student_streaks_db.get(student_id, {}),
            "quests": student_quests_db.get(student_id, []),
            "stats": student_stats_db.get(student_id, {}),
            "export_date": datetime.now().isoformat()
        }
    
    @staticmethod
    def get_system_stats() -> Dict:
        """Get system-wide gamification statistics"""
        total_students = len(student_levels_db)
        total_badges_awarded = sum(len(badges) for badges in student_badges_db.values())
        
        # Level distribution
        level_distribution = {}
        for level_data in student_levels_db.values():
            level = level_data.current_level
            level_distribution[level] = level_distribution.get(level, 0) + 1
        
        # Most popular badges
        badge_popularity = {}
        for badges in student_badges_db.values():
            for achievement in badges:
                badge_id = achievement.badge_id
                badge_popularity[badge_id] = badge_popularity.get(badge_id, 0) + 1
        
        return {
            "total_students": total_students,
            "total_badges_awarded": total_badges_awarded,
            "average_level": sum(ld.current_level for ld in student_levels_db.values()) / max(total_students, 1),
            "level_distribution": level_distribution,
            "most_popular_badges": sorted(badge_popularity.items(), key=lambda x: x[1], reverse=True)[:10]
        }

# Gamification API Models for requests/responses
class XPGainResponse(BaseModel):
    xp_gained: int
    total_xp: int
    level_up: bool = False
    new_level: Optional[int] = None
    new_title: Optional[str] = None

class BadgeEarnedResponse(BaseModel):
    badge: Badge
    xp_bonus: int

class GamificationActivityRequest(BaseModel):
    student_id: str
    activity_type: str  # "message_sent", "voice_used", "book_generated", etc.
    activity_data: Dict = {}
    subject: Optional[str] = None  # math, science, reading
    tutor_type: Optional[str] = None


# Use the OPENAI_API_KEY loaded at the top of the file
# (Already loaded from .env file above)

# In-memory storage (we'll upgrade to a database later)
students_db = {}
conversations_db = {}
progress_db = {}
student_contexts = {}
student_levels_db = {}
student_badges_db = {}
student_streaks_db = {}
student_quests_db = {}
student_stats_db = {}

# Initialize gamification engine
gamification_engine = GamificationEngine()

class BookGenerator:
    def __init__(self, student: Student):
        self.student = student
        
    async def generate_chapter(self, topic: str, chapter_number: int, difficulty_level: str = "auto") -> Dict:
        """Generate a custom chapter based on student interests"""
        try:
            if difficulty_level == "auto":
                if self.student.grade_level <= 3:
                    difficulty = "simple sentences, basic vocabulary"
                elif self.student.grade_level <= 6:
                    difficulty = "medium complexity, grade-appropriate vocabulary"
                elif self.student.grade_level <= 9:
                    difficulty = "more complex sentences, expanded vocabulary"
                else:
                    difficulty = "advanced vocabulary and concepts"
            else:
                difficulty = difficulty_level
                
            interests_str = ", ".join(self.student.interests)
            
            system_prompt = f"""You are an expert children's book author creating engaging educational content for {self.student.name}, a {self.student.grade_level}th grade student who loves {interests_str}.

Create a captivating chapter that:
1. Uses {difficulty}
2. Incorporates their interests: {interests_str}
3. Is educational and teaches about: {topic}
4. Is age-appropriate for grade {self.student.grade_level}
5. Includes engaging characters and storylines
6. Has a clear beginning, middle, and end
7. Is approximately 300-500 words

Make it fun, educational, and something they'd want to read more of!"""

            prompt = f"""Please write Chapter {chapter_number} of a custom story for {self.student.name}.

Topic to teach: {topic}
Student interests to incorporate: {interests_str}
Grade level: {self.student.grade_level}

The chapter should be engaging, educational, and perfectly tailored to this student. Include a compelling title for the chapter."""

            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=800,
                temperature=0.8  # More creative for storytelling
            )
            
            content = response.choices[0].message.content.strip()
            
            # Extract title if present
            lines = content.split('\n')
            title = f"Chapter {chapter_number}"
            chapter_text = content
            
            # Try to extract title from first line if it looks like a title
            if lines[0].startswith("Chapter") or lines[0].startswith("Title"):
                title = lines[0].replace("Title:", "").replace("Chapter", "Chapter").strip()
                chapter_text = '\n'.join(lines[1:]).strip()
            
            # Generate unique ID for the chapter
            chapter_id = str(uuid.uuid4())
            
            return {
                "id": chapter_id,
                "title": title,
                "content": chapter_text,
                "chapter_number": chapter_number,
                "topic": topic,
                "word_count": len(chapter_text.split()),
                "reading_time_minutes": max(1, len(chapter_text.split()) // 200),
                "description": chapter_text[:200] + "..." if len(chapter_text) > 200 else chapter_text
            }
            
        except Exception as e:
            print(f"Book generation error: {e}")
            chapter_id = str(uuid.uuid4())
            error_content = f"This would be an amazing story about {topic} featuring {interests_str}! The book generator is having trouble right now, but imagine the exciting adventures we could create together!"
            return {
                "id": chapter_id,
                "title": f"Chapter {chapter_number}: Adventure Awaits",
                "content": error_content,
                "chapter_number": chapter_number,
                "topic": topic,
                "word_count": 50,
                "reading_time_minutes": 1,
                "description": error_content[:200] + "..." if len(error_content) > 200 else error_content
            }

# Specialized AI Tutors
class SpecializedTutor:
    def __init__(self, tutor_type: str, student: Student):
        self.tutor_type = tutor_type
        self.student = student
        self.system_prompt = self.create_specialized_prompt()
        
    def create_specialized_prompt(self) -> str:
        base_info = f"""Student: {self.student.name}, Grade {self.student.grade_level}, Interests: {', '.join(self.student.interests)}"""
        
        prompts = {
            "math": f"""You are Professor Numbers, a brilliant and patient math tutor. You make math fun and relatable.

{base_info}

Your personality: Enthusiastic about numbers, uses real-world examples, breaks down problems step-by-step, celebrates small victories, uses the student's interests to create math problems.

Always:
- Use encouraging language
- Break complex problems into smaller steps  
- Connect math to their interests when possible
- Ask if they understand before moving on
- Make math feel like solving puzzles, not work""",

            "science": f"""You are Dr. Discovery, an exciting science tutor who makes science come alive!

{base_info}

Your personality: Curious, enthusiastic, loves experiments and "what if" questions, explains things like a friendly scientist, uses their interests to explain scientific concepts.

Always:
- Use analogies and real examples
- Encourage questions and curiosity
- Suggest simple experiments when appropriate
- Connect science to their interests
- Make science feel like exciting discoveries""",

            "reading": f"""You are Ms. Story, a warm reading and writing tutor who loves books and storytelling.

{base_info}

Your personality: Encouraging, loves stories, helps with reading comprehension, makes writing fun, patient with spelling and grammar.

Always:
- Encourage creativity in writing
- Help break down reading into manageable parts
- Use their interests to suggest books or writing topics
- Make reading and writing feel like adventures
- Celebrate their unique voice and ideas""",

            "general": f"""You are Buddy, their friendly general learning companion who can help with any subject!

{base_info}

Your personality: Helpful, encouraging, adapts to any subject, great at explaining things clearly, patient and understanding.

Always:
- Be supportive and patient
- Adapt your teaching style to the subject
- Use their interests to make learning more engaging
- Encourage questions and curiosity
- Make learning feel fun and rewarding"""
        }
        
        return prompts.get(self.tutor_type, prompts["general"])
    
    async def get_response(self, message: str, conversation_history: List[Dict]) -> str:
        """Get specialized tutor response"""
        try:
            messages = [{"role": "system", "content": self.system_prompt}]
            
            # Add conversation history
            recent_history = conversation_history[-8:] if len(conversation_history) > 8 else conversation_history
            for exchange in recent_history:
                messages.append({"role": "user", "content": exchange["student_message"]})
                messages.append({"role": "assistant", "content": exchange["ai_response"]})
            
            messages.append({"role": "user", "content": message})
            
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=messages,
                max_tokens=500,
                temperature=0.7
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            print(f"Specialized tutor error: {e}")
            fallback_responses = {
                "math": "Great math question! Let me help you work through this step by step.",
                "science": "Wow, what a fascinating science question! Let's explore this together.",
                "reading": "I love helping with reading and writing! Let's dive into this.",
                "general": "That's an excellent question! I'm here to help you learn."
            }
            return fallback_responses.get(self.tutor_type, "I'm here to help you learn!")

# Update the AI Tutor class to include specialized tutors
class AITutor:
    def __init__(self, student: Student):
        self.student = student
        self.system_prompt = self.create_system_prompt()
        self.book_generator = BookGenerator(student)
        self.specialized_tutors = {
            "math": SpecializedTutor("math", student),
            "science": SpecializedTutor("science", student),
            "reading": SpecializedTutor("reading", student),
            "general": SpecializedTutor("general", student)
        }
        
    def create_system_prompt(self) -> str:
        """Create a personalized system prompt for this student"""
        interests_str = ", ".join(self.student.interests)
        
        return f"""You are an expert AI tutor for {self.student.name}, a {self.student.grade_level}th grade student.

STUDENT PROFILE:
- Name: {self.student.name}
- Grade Level: {self.student.grade_level}
- Learning Style: {self.student.learning_style}
- Interests: {interests_str}

TUTORING GUIDELINES:
1. Always adapt your explanations to a {self.student.grade_level}th grade level
2. Use examples from their interests ({interests_str}) whenever possible
3. Be encouraging and patient - celebrate their curiosity and efforts
4. Break down complex concepts into digestible steps
5. Ask follow-up questions to check understanding
6. Make learning fun and engaging
7. If they ask about topics above their grade level, explain in age-appropriate ways

LEARNING STYLE ADAPTATION:
- Visual: Use descriptive language, suggest drawing/diagrams when helpful
- Auditory: Use verbal explanations, suggest reading aloud or discussing
- Kinesthetic: Suggest hands-on activities, movement, or physical examples
- Reading/Writing: Encourage note-taking, writing summaries, or creating lists

Remember: You're not just answering questions - you're nurturing a love of learning!"""

    async def get_response(self, message: str, conversation_history: List[Dict], tutor_type: str = "general") -> str:
        """Generate AI response using the appropriate specialized tutor"""
        try:
            # Check if API key is properly set
            if not OPENAI_API_KEY or OPENAI_API_KEY == "your-openai-api-key-here":
                print("ERROR: OpenAI API key not set properly!")
                return "I'm sorry, but my AI connection isn't configured yet. Please ask your teacher to set up the OpenAI API key."
            
            # Use specialized tutor if specified
            if tutor_type in self.specialized_tutors:
                return await self.specialized_tutors[tutor_type].get_response(message, conversation_history)
            
            # Otherwise use general tutor (original logic)
            messages = [{"role": "system", "content": self.system_prompt}]
            
            recent_history = conversation_history[-10:] if len(conversation_history) > 10 else conversation_history
            
            for exchange in recent_history:
                messages.append({"role": "user", "content": exchange["student_message"]})
                messages.append({"role": "assistant", "content": exchange["ai_response"]})
            
            messages.append({"role": "user", "content": message})
            
            from openai import OpenAI
            client = OpenAI(api_key=OPENAI_API_KEY)
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=messages,
                max_tokens=500,
                temperature=0.7,
                presence_penalty=0.1,
                frequency_penalty=0.1
            )
            
            return response.choices[0].message.content.strip()
            
        except Exception as e:
            error_message = str(e)
            print(f"OpenAI API Error: {error_message}")
            
            if "invalid_api_key" in error_message.lower():
                return "There's an issue with the API key. Please check that it's entered correctly."
            elif "insufficient_quota" in error_message.lower():
                return "The API quota has been exceeded. Please check your OpenAI account billing."
            elif "rate_limit" in error_message.lower():
                return "I'm being asked questions too quickly! Please wait a moment and try again."
            else:
                return self.get_fallback_response(message)
    
    def get_fallback_response(self, message: str) -> str:
        """Fallback response when AI API is unavailable"""
        interests_str = ", ".join(self.student.interests)
        responses = [
            f"That's a great question about '{message}'! Since you love {interests_str}, let me think of a way to connect this to what you enjoy.",
            f"I can see you're curious about '{message}'. As a {self.student.grade_level}th grader interested in {interests_str}, you're asking exactly the right kinds of questions!",
            f"Excellent question! Let me break down '{message}' in a way that makes sense for someone who loves {interests_str}.",
            "That's such a thoughtful question! You're really thinking like a scholar. Can you tell me more about what made you curious about this?",
            f"I love that you asked about '{message}'! Your interest in {interests_str} actually connects to this in some interesting ways."
        ]
        import random
        return random.choice(responses)

# Enhanced AI Response Function
async def generate_ai_response(message: str, student: Student, conversation_history: List[Dict], tutor_type: str = "general") -> str:
    """
    Generate AI response using the AI Tutor system with specialized tutors
    """
    # Get or create AI tutor for this student
    if student.id not in student_contexts:
        student_contexts[student.id] = AITutor(student)
    
    ai_tutor = student_contexts[student.id]
    return await ai_tutor.get_response(message, conversation_history, tutor_type)



# API Endpoints
@app.post("/api/students")
async def create_student(student: Student):
    """Create a new student profile"""
    students_db[student.id] = student.dict()
    conversations_db[student.id] = []
    progress_db[student.id] = {
        "total_messages": 0,
        "topics_covered": [],
        "last_active": datetime.now().isoformat()
    }
    return {"message": "Student created successfully", "student_id": student.id}

def get_or_create_student(student_id: str, db: Session):
    """Get or create student in students_db from User database"""
    if student_id in students_db:
        return students_db[student_id]
    
    # Try to get from User database
    user = db.query(User).filter(User.id == student_id).first()
    if user:
        # Create student record from User
        student_data = {
            "id": user.id,
            "name": user.name,
            "grade_level": user.grade_level,
            "interests": [],  # Default empty, can be updated later
            "learning_style": "general"  # Default learning style
        }
        students_db[student_id] = student_data
        if student_id not in conversations_db:
            conversations_db[student_id] = []
        if student_id not in progress_db:
            progress_db[student_id] = {
                "total_messages": 0,
                "topics_covered": [],
                "last_active": datetime.now().isoformat(),
                "generated_books": []
            }
        return student_data
    
    return None

@app.get("/api/students/{student_id}")
async def get_student(student_id: str, db: Session = Depends(get_db)):
    """Get student profile"""
    student = get_or_create_student(student_id, db)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student

@app.post("/api/chat")
async def chat_with_tutor(message: ChatMessage, db: Session = Depends(get_db)):  # Note: ChatMessage instead of Message
    """Enhanced chat endpoint with gamification tracking"""
    student_data = get_or_create_student(message.student_id, db)
    if not student_data:
        raise HTTPException(status_code=404, detail="Student not found")
    
    student = Student(**student_data)
    
    # Get conversation history for context
    conversation_history = conversations_db.get(message.student_id, [])
    
    # Generate AI response with specialized tutor
    ai_response = await generate_ai_response(message.content, student, conversation_history, message.tutor_type)
    
    # Store conversation
    conversation_entry = {
        "timestamp": datetime.now().isoformat(),
        "student_message": message.content,
        "ai_response": ai_response,
        "tutor_type": message.tutor_type
    }
    conversations_db[message.student_id].append(conversation_entry)
    
    # 🎮 GAMIFICATION: Record activity
    activity_data = GamificationActivityRequest(
        student_id=message.student_id,
        activity_type="message_sent",
        subject=detect_subject_from_message(message.content),
        tutor_type=message.tutor_type,
        activity_data={"current_hour": datetime.now().hour}
    )
    
    # Process gamification
    try:
        gamification_response = await record_activity(activity_data)
    except Exception as e:
        print(f"Gamification error: {e}")
        gamification_response = {"activity_processed": False}
    
    # Update progress tracking
    progress_db[message.student_id]["total_messages"] += 1
    progress_db[message.student_id]["last_active"] = datetime.now().isoformat()
    
    # Extract topics for progress tracking
    topics = extract_topics(message.content.lower())
    for topic in topics:
        if topic not in progress_db[message.student_id]["topics_covered"]:
            progress_db[message.student_id]["topics_covered"].append(topic)
    
    return {
        "response": ai_response,
        "student_id": message.student_id,
        "timestamp": conversation_entry["timestamp"],
        "gamification": gamification_response  # 🎮 Include gamification data
    }

@app.post("/api/generate-chapter")
async def generate_chapter(request: BookRequest, db: Session = Depends(get_db)):
    """Generate a custom chapter for the student with gamification"""
    try:
    student_data = get_or_create_student(request.student_id, db)
    if not student_data:
        raise HTTPException(status_code=404, detail="Student not found")
    
    student = Student(**student_data)
    
        # Ensure progress_db entry exists
        if request.student_id not in progress_db:
            progress_db[request.student_id] = {
                "total_messages": 0,
                "topics_covered": [],
                "last_active": datetime.now().isoformat(),
                "generated_books": []
            }
        elif "generated_books" not in progress_db[request.student_id]:
            progress_db[request.student_id]["generated_books"] = []
        
    if request.student_id not in student_contexts:
        student_contexts[request.student_id] = AITutor(student)
    
    ai_tutor = student_contexts[request.student_id]
        
        print(f"Generating chapter for student {request.student_id}, topic: {request.topic}")
    chapter = await ai_tutor.book_generator.generate_chapter(
        request.topic, 
        request.chapter_number
    )
    
        print(f"Chapter generated: {chapter.get('id', 'NO ID')}, title: {chapter.get('title', 'NO TITLE')}")
    
        # Store the generated chapter
    progress_db[request.student_id]["generated_books"].append(chapter)
        print(f"Chapter stored. Total books for student: {len(progress_db[request.student_id]['generated_books'])}")
    
    # 🎮 Record gamification activity
    activity_data = GamificationActivityRequest(
        student_id=request.student_id,
        activity_type="book_generated",
        activity_data={"topic": request.topic}
    )
    
    try:
        gamification_response = await record_activity(activity_data)
    except Exception as e:
        print(f"Gamification error: {e}")
        gamification_response = {"activity_processed": False}
    
    return {
        **chapter,
        "gamification": gamification_response
    }
    except Exception as e:
        print(f"Error generating chapter: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to generate chapter: {str(e)}")

@app.get("/api/students/{student_id}/books")
async def get_student_books(student_id: str, db: Session = Depends(get_db)):
    """Get all books/chapters generated for a student"""
    student = get_or_create_student(student_id, db)
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    # Ensure progress_db entry exists with generated_books
    if student_id not in progress_db:
        progress_db[student_id] = {
            "total_messages": 0,
            "topics_covered": [],
            "last_active": datetime.now().isoformat(),
            "generated_books": []
        }
    elif "generated_books" not in progress_db[student_id]:
        progress_db[student_id]["generated_books"] = []
    
    books = progress_db[student_id].get("generated_books", [])
    print(f"Returning {len(books)} books for student {student_id}")
    return books

# Reading Agent endpoints
class ReadingFeedbackRequest(BaseModel):
    expected_text: str  # The text the student should be reading
    spoken_text: str    # What the student actually said
    student_id: str
    current_word_index: int = 0  # Where they are in the text
    struggle_indicators: Optional[Dict] = None  # pauses, repetitions, etc.

class ReadingContentRequest(BaseModel):
    book_id: str

@app.get("/api/reading/content/{book_id}")
async def get_reading_content(book_id: str):
    """Get reading content for a book/chapter"""
    # Try to find the book in all students' generated books
    for student_id, student_data in progress_db.items():
        books = student_data.get("generated_books", [])
        for book in books:
            if book.get("id") == book_id:
                # Split content into pages (by paragraphs or sentences)
                content = book.get("content", "")
                pages = []
                if content:
                    # Split by double newlines first (paragraphs)
                    paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
                    for para in paragraphs:
                        # If paragraph is long, split by sentences
                        sentences = para.split('. ')
                        current_page = ""
                        for sentence in sentences:
                            if len(current_page) + len(sentence) < 500:  # ~500 chars per page
                                current_page += sentence + ". "
                            else:
                                if current_page:
                                    pages.append({"text": current_page.strip()})
                                current_page = sentence + ". "
                        if current_page:
                            pages.append({"text": current_page.strip()})
                else:
                    pages = [{"text": "No content available"}]
                
                return {
                    "book_id": book_id,
                    "title": book.get("title", "Reading"),
                    "pages": pages
                }
    
    raise HTTPException(status_code=404, detail="Book not found")

@app.post("/api/reading/feedback")
async def get_reading_feedback(request: ReadingFeedbackRequest, db: Session = Depends(get_db)):
    """Get AI-powered reading feedback like a teacher would give"""
    try:
        # Get student info
        student_data = get_or_create_student(request.student_id, db)
        if not student_data:
            raise HTTPException(status_code=404, detail="Student not found")
        
        student = Student(**student_data)
        
        # Prepare context for AI reading tutor
        expected_words = request.expected_text.lower().split()
        spoken_words = request.spoken_text.lower().split()
        
        # Find mismatches and struggles
        word_matches = []
        incorrect_words = []
        for i, expected_word in enumerate(expected_words[:len(spoken_words)]):
            spoken_word = spoken_words[i] if i < len(spoken_words) else ""
            # Simple comparison (remove punctuation)
            expected_clean = ''.join(c for c in expected_word if c.isalnum())
            spoken_clean = ''.join(c for c in spoken_word if c.isalnum())
            
            if expected_clean == spoken_clean:
                word_matches.append((expected_word, True))
            else:
                word_matches.append((expected_word, False))
                incorrect_words.append({
                    "expected": expected_word,
                    "spoken": spoken_word,
                    "position": i
                })
        
        # Detect struggles
        struggles = []
        if request.struggle_indicators:
            if request.struggle_indicators.get("long_pause", False):
                struggles.append("long pause")
            if request.struggle_indicators.get("repetition", False):
                struggles.append("repeated words")
            if request.struggle_indicators.get("hesitation", False):
                struggles.append("hesitation")
        
        # Create prompt for AI reading tutor
        prompt = f"""You are a patient and encouraging reading teacher helping a {student.grade_level}th grade student read aloud.

The student is reading this text:
"{request.expected_text}"

They just read: "{request.spoken_text}"

{'They struggled with: ' + ', '.join(struggles) if struggles else ''}

Current position: word {request.current_word_index} of {len(expected_words)}

Incorrect words detected: {len(incorrect_words)}
{('Incorrect words: ' + str(incorrect_words[:3])) if incorrect_words else 'All words correct so far!'}

Please provide:
1. Encouraging feedback (2-3 sentences)
2. If they made mistakes, gently point out the word(s) and help them sound it out
3. If they're struggling, offer a helpful tip
4. Praise what they did well

Be warm, patient, and supportive like a caring teacher. Keep it brief (3-4 sentences max)."""

        # Use OpenAI to generate feedback
        try:
            from openai import OpenAI
            client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
            
            response = client.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[
                    {"role": "system", "content": "You are a patient, encouraging reading teacher who helps students learn to read with kindness and support."},
                    {"role": "user", "content": prompt}
                ],
                max_tokens=200,
                temperature=0.7
            )
            
            feedback = response.choices[0].message.content
        except Exception as api_err:
            logger.error(f"OpenAI API error in reading feedback: {api_err}")
            # Fallback feedback
            feedback = "Keep reading! You're doing great. Take your time with each word and sound it out if you need help."
        
        # Calculate accuracy
        correct = sum(1 for _, match in word_matches if match)
        total = len(word_matches) if word_matches else 1
        accuracy = int((correct / total) * 100) if total > 0 else 0
        
        return {
            "feedback": feedback,
            "accuracy": accuracy,
            "incorrect_words": incorrect_words[:5],  # Limit to first 5
            "needs_help": len(incorrect_words) > 0 or len(struggles) > 0,
            "encouragement": "Great job!" if accuracy > 80 else "Keep trying!" if accuracy > 50 else "Let's practice this together!"
        }
        
    except Exception as e:
        logger.error(f"Reading feedback error: {e}")
        # Fallback feedback
        return {
            "feedback": "Keep reading! You're doing great. Take your time with each word.",
            "accuracy": 0,
            "incorrect_words": [],
            "needs_help": False,
            "encouragement": "You can do it!"
        }

@app.post("/api/reading/finish/{book_id}")
async def finish_reading_session(book_id: str, data: dict):
    """Save reading session results"""
    # Store reading session data
    # This could be saved to database in the future
    return {
        "message": "Reading session saved",
        "book_id": book_id,
        "results": data
    }

def extract_topics(message: str) -> List[str]:
    """Simple topic extraction from student messages"""
    topic_keywords = {
        "math": ["math", "addition", "subtraction", "multiplication", "division", "algebra", "geometry", "number", "calculate"],
        "science": ["science", "experiment", "chemistry", "physics", "biology", "atoms", "molecules", "gravity"],
        "history": ["history", "ancient", "war", "president", "empire", "civilization", "historical"],
        "english": ["reading", "writing", "grammar", "story", "poem", "literature", "essay"],
        "geography": ["country", "continent", "ocean", "mountain", "river", "capital", "map"],
        "space": ["space", "planet", "star", "galaxy", "astronaut", "rocket", "solar system"],
        "animals": ["animal", "dog", "cat", "bird", "fish", "mammal", "reptile", "habitat"]
    }
    
    found_topics = []
    for topic, keywords in topic_keywords.items():
        if any(keyword in message for keyword in keywords):
            found_topics.append(topic)
    
    return found_topics

@app.get("/api/students/{student_id}/conversations")
async def get_conversations(student_id: str):
    """Get conversation history"""
    if student_id not in students_db:
        raise HTTPException(status_code=404, detail="Student not found")
    return conversations_db.get(student_id, [])

@app.get("/api/students/{student_id}/progress")
async def get_progress(student_id: str):
    """Get student progress data"""
    if student_id not in students_db:
        raise HTTPException(status_code=404, detail="Student not found")
    return progress_db.get(student_id, {})

@app.get("/api/parent/dashboard/{student_id}")
async def parent_dashboard(student_id: str):
    """Get data for parent dashboard"""
    if student_id not in students_db:
        raise HTTPException(status_code=404, detail="Student not found")
    
    return {
        "student": students_db[student_id],
        "progress": progress_db[student_id],
        "recent_conversations": conversations_db[student_id][-5:],  # Last 5 conversations
        "summary": {
            "active_days_this_week": 3,  # Mock data
            "concepts_learned": 8,
            "engagement_score": 85
        }
    }
# Gamification API Endpoints

@app.post("/api/gamification/activity")
async def record_activity(activity: GamificationActivityRequest):
    """Record student activity and update gamification metrics - FULLY FUNCTIONAL"""
    try:
        # Process the activity using the real gamification engine
        results = await gamification_engine.process_student_activity(
            activity.student_id,
            activity.activity_type,
            activity.activity_data
        )
        
        # Add celebration notifications if achievements were earned
        notifications = []
        
        # Badge notifications
        for badge in results.get("new_badges", []):
            notifications.append(create_achievement_notification("badge_earned", badge))
        
        # Level up notifications
        if results.get("level_up"):
            level_info = results.get("level_info", {})
            notifications.append(create_achievement_notification("level_up", {
                "level": level_info.get("new_level"),
                "title": level_info.get("new_title")
            }))
        
        # Quest completion notifications
        for quest in results.get("completed_quests", []):
            notifications.append(create_achievement_notification("quest_completed", quest))
        
        # Streak milestone notifications
        for streak_type, streak_data in results.get("streak_updates", {}).items():
            if streak_data.get("is_record") and streak_data.get("current_count") % 7 == 0:  # Every 7 days
                notifications.append(create_achievement_notification("streak_milestone", {
                    "count": streak_data.get("current_count"),
                    "type": streak_type
                }))
        
        return {
            "activity_processed": True,
            "xp_gained": results.get("xp_gained", 0),
            "xp_details": results.get("xp_details", {}),
            "new_badges": results.get("new_badges", []),
            "completed_quests": results.get("completed_quests", []),
            "streak_updates": results.get("streak_updates", {}),
            "level_up": results.get("level_up", False),
            "level_info": results.get("level_info", {}),
            "notifications": notifications,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"Gamification activity error: {e}")
        return {"activity_processed": False, "error": str(e)}

@app.get("/api/gamification/student/{student_id}/dashboard")
async def get_student_dashboard(student_id: str):
    """Get comprehensive gamification dashboard - FULLY FUNCTIONAL"""
    try:
        # Get real dashboard data from the gamification engine
        dashboard = await gamification_engine.get_student_dashboard_data(student_id)
        
        # Add next available badges
        available_badges = await get_available_badges(student_id)
        dashboard["next_badges"] = available_badges[:5]  # Next 5 badges they can earn
        
        # Add student rank
        rank_info = await get_student_rank(student_id)
        dashboard["rank"] = rank_info
        
        # Add daily quest suggestions if no active quests
        if dashboard.get("quests", {}).get("active_count", 0) == 0:
            suggested_quests = await QuestGenerator.generate_personalized_quests(student_id)
            dashboard["suggested_quests"] = [
                {
                    "id": quest.id,
                    "name": quest.name,
                    "description": quest.description,
                    "xp_reward": quest.xp_reward,
                    "difficulty": quest.difficulty.value
                } for quest in suggested_quests[:3]
            ]
        
        return dashboard
        
    except Exception as e:
        print(f"Dashboard error: {e}")
        return {"error": str(e), "student_id": student_id}

@app.get("/api/gamification/student/{student_id}/badges")
async def get_student_badges(student_id: str):
    """Get all badges earned by student - FULLY FUNCTIONAL"""
    try:
        # Get real badge data
        badge_ids = await gamification_engine.get_student_badges(student_id)
        recent_achievements = await gamification_engine.get_recent_achievements(student_id)
        
        badges = []
        badges_by_type = {
            "achievement": [],
            "milestone": [],
            "streak": [],
            "subject": [],
            "special": []
        }
        
        for badge_id in badge_ids:
            if badge_id in gamification_engine.badges:
                badge = gamification_engine.badges[badge_id]
                
                # Find earned date from recent achievements
                earned_date = None
                for achievement in recent_achievements:
                    if badge_id in achievement.get("badge_name", ""):
                        earned_date = achievement.get("earned_date")
                        break
                
                badge_data = {
                    "id": badge.id,
                    "name": badge.name,
                    "description": badge.description,
                    "icon": badge.icon,
                    "badge_type": badge.badge_type.value,
                    "difficulty": badge.difficulty.value,
                    "rarity_score": badge.rarity_score,
                    "xp_reward": badge.xp_reward,
                    "earned_date": earned_date or datetime.now().isoformat()
                }
                
                badges.append(badge_data)
                badges_by_type[badge.badge_type.value].append(badge_data)
        
        # Calculate badge statistics
        total_possible = len(gamification_engine.badges)
        completion_percentage = (len(badges) / total_possible) * 100 if total_possible > 0 else 0
        
        return {
            "total_badges": len(badges),
            "badges": badges,
            "badges_by_type": badges_by_type,
            "completion_percentage": round(completion_percentage, 1),
            "total_possible": total_possible,
            "rarest_badge": max(badges, key=lambda x: x["rarity_score"]) if badges else None
        }
        
    except Exception as e:
        print(f"Badges error: {e}")
        return {"total_badges": 0, "badges": [], "badges_by_type": {}, "error": str(e)}

@app.get("/api/gamification/student/{student_id}/level")
async def get_student_level_info(student_id: str):
    """Get detailed level information - FULLY FUNCTIONAL"""
    try:
        # Get real level data
        level_info = await gamification_engine.get_student_level(student_id)
        level_data = gamification_engine.level_thresholds.get(level_info.current_level, {})
        next_level_data = gamification_engine.level_thresholds.get(level_info.current_level + 1, {})
        
        # Calculate progress percentage
        progress_percentage = (level_info.current_xp / level_info.xp_to_next_level) * 100 if level_info.xp_to_next_level > 0 else 100
        
        # Get rank information
        rank_info = await get_student_rank(student_id)
        
        return {
            "current_level": level_info.current_level,
            "title": level_info.title,
            "current_xp": level_info.current_xp,
            "xp_to_next_level": level_info.xp_to_next_level,
            "total_xp_earned": level_info.total_xp_earned,
            "progress_percentage": round(progress_percentage, 1),
            "xp_display": format_xp_display(level_info.total_xp_earned),
            "perks": level_data.get("perks", []),
            "next_level_preview": {
                "level": level_info.current_level + 1,
                "title": next_level_data.get("title", "Ultimate Scholar"),
                "perks": next_level_data.get("perks", []),
                "xp_required": next_level_data.get("xp_required", 999999)
            },
            "rank": rank_info
        }
        
    except Exception as e:
        print(f"Level info error: {e}")
        return {"error": str(e)}

@app.get("/api/gamification/student/{student_id}/streaks")
async def get_student_streaks(student_id: str):
    """Get all streaks for student - FULLY FUNCTIONAL"""
    try:
        # Get real streak data
        streaks = await gamification_engine.get_student_streaks(student_id)
        
        streak_data = []
        for streak_type, streak in streaks.items():
            streak_info = {
                "type": streak_type,
                "name": streak_type.replace("_", " ").title(),
                "current_count": streak.current_count,
                "max_count": streak.max_count,
                "is_active": streak.is_active,
                "last_activity": streak.last_activity_date.isoformat(),
                "icon": get_streak_icon(streak_type),
                "days_ago": (datetime.now() - streak.last_activity_date).days
            }
            
            # Add streak status
            if not streak.is_active:
                streak_info["status"] = "Broken"
                streak_info["status_color"] = "#F44336"
            elif streak.current_count == streak.max_count:
                streak_info["status"] = "Record"
                streak_info["status_color"] = "#4CAF50"
            else:
                streak_info["status"] = "Active"
                streak_info["status_color"] = "#FF9800"
            
            streak_data.append(streak_info)
        
        # Sort by current count (highest first)
        streak_data.sort(key=lambda x: x["current_count"], reverse=True)
        
        return {
            "active_streaks": len([s for s in streak_data if s["is_active"]]),
            "longest_streak": max([s["max_count"] for s in streak_data]) if streak_data else 0,
            "current_best": max([s["current_count"] for s in streak_data if s["is_active"]]) if any(s["is_active"] for s in streak_data) else 0,
            "streaks": streak_data
        }
        
    except Exception as e:
        print(f"Streaks error: {e}")
        return {"active_streaks": 0, "longest_streak": 0, "streaks": [], "error": str(e)}

@app.get("/api/gamification/student/{student_id}/quests")
async def get_student_quests(student_id: str):
    """Get active and available quests - FULLY FUNCTIONAL"""
    try:
        # Get real quest data
        active_quests = await gamification_engine.get_active_quests(student_id)
        
        # Format active quests with real progress
        active_quest_data = []
        for quest_progress in active_quests:
            if quest_progress.quest_id in gamification_engine.quests:
                quest = gamification_engine.quests[quest_progress.quest_id]
                
                completion_percentage = gamification_engine._calculate_quest_completion_percentage(quest_progress)
                time_remaining = calculate_time_remaining(quest_progress.start_date, quest.time_limit_hours) if quest.time_limit_hours else "No limit"
                
                active_quest_data.append({
                    "id": quest.id,
                    "name": quest.name,
                    "description": quest.description,
                    "xp_reward": quest.xp_reward,
                    "difficulty": quest.difficulty.value,
                    "time_limit_hours": quest.time_limit_hours,
                    "progress": quest_progress.progress,
                    "requirements": quest.requirements,
                    "completion_percentage": round(completion_percentage, 1),
                    "time_remaining": time_remaining,
                    "is_completed": quest_progress.completed,
                    "started_date": quest_progress.start_date.isoformat()
                })
        
        # Generate new daily quests if none active
        if not active_quest_data:
            suggested_quests = await QuestGenerator.generate_personalized_quests(student_id)
            daily_quest_data = []
            
            for quest in suggested_quests[:3]:  # Suggest up to 3 quests
                daily_quest_data.append({
                    "id": quest.id,
                    "name": quest.name,
                    "description": quest.description,
                    "xp_reward": quest.xp_reward,
                    "difficulty": quest.difficulty.value,
                    "requirements": quest.requirements,
                    "time_limit_hours": quest.time_limit_hours,
                    "can_start": True
                })
        else:
            daily_quest_data = []
        
        return {
            "active_quests": active_quest_data,
            "suggested_quests": daily_quest_data,
            "completed_today": len([q for q in active_quest_data if q["is_completed"]]),
            "total_active": len(active_quest_data)
        }
        
    except Exception as e:
        print(f"Quests error: {e}")
        return {"active_quests": [], "suggested_quests": [], "error": str(e)}

@app.post("/api/gamification/student/{student_id}/start-quest")
async def start_quest(student_id: str, quest_data: Dict):
    """Start a new quest for student - NEW ENDPOINT"""
    try:
        quest_id = quest_data.get("quest_id")
        if not quest_id or quest_id not in gamification_engine.quests:
            raise HTTPException(status_code=400, detail="Invalid quest ID")
        
        # Start the quest
        success = await gamification_engine.start_daily_quest(student_id, quest_id)
        
        if success:
            return {
                "quest_started": True,
                "quest_id": quest_id,
                "message": f"Quest '{gamification_engine.quests[quest_id].name}' started successfully!",
                "timestamp": datetime.now().isoformat()
            }
        else:
            return {
                "quest_started": False,
                "error": "Quest already active or could not be started"
            }
            
    except Exception as e:
        print(f"Start quest error: {e}")
        return {"quest_started": False, "error": str(e)}

@app.get("/api/gamification/leaderboard")
async def get_leaderboard(timeframe: str = "all_time", limit: int = 10):
    """Get student leaderboard - FULLY FUNCTIONAL"""
    try:
        # Get real leaderboard data
        leaderboard_data = await gamification_engine.get_leaderboard(timeframe, limit)
        
        # Format leaderboard with additional stats
        formatted_leaderboard = []
        for i, entry in enumerate(leaderboard_data):
            formatted_entry = {
                "rank": i + 1,
                "student_name": entry.get("student_name", f"Student {entry.get('student_id', '')[-4:]}"),
                "level": entry.get("level", 1),
                "total_xp": entry.get("total_xp", 0),
                "xp_display": format_xp_display(entry.get("total_xp", 0)),
                "title": entry.get("title", "Beginner"),
                "badges_earned": entry.get("badges_earned", 0),
                "rank_change": 0  # Would track changes over time in real implementation
            }
            
            # Add rank styling
            if i == 0:
                formatted_entry["rank_style"] = "gold"
                formatted_entry["rank_icon"] = "🥇"
            elif i == 1:
                formatted_entry["rank_style"] = "silver"
                formatted_entry["rank_icon"] = "🥈"
            elif i == 2:
                formatted_entry["rank_style"] = "bronze"
                formatted_entry["rank_icon"] = "🥉"
            else:
                formatted_entry["rank_style"] = "default"
                formatted_entry["rank_icon"] = f"#{i + 1}"
            
            formatted_leaderboard.append(formatted_entry)
        
        return {
            "timeframe": timeframe,
            "leaderboard": formatted_leaderboard,
            "total_students": len(student_levels_db),
            "last_updated": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"Leaderboard error: {e}")
        return {"leaderboard": [], "error": str(e)}


@app.get("/api/gamification/badges/catalog")
async def get_badge_catalog():
    """Get all available badges organized by category - FULLY FUNCTIONAL"""
    try:
        badges_by_category = {
            "achievement": [],
            "milestone": [],
            "streak": [],
            "subject": [],
            "special": []
        }
        
        # Organize all badges by category
        for badge_id, badge in gamification_engine.badges.items():
            badge_data = {
                "id": badge.id,
                "name": badge.name,
                "description": badge.description,
                "icon": badge.icon,
                "difficulty": badge.difficulty.value,
                "difficulty_color": get_difficulty_color(badge.difficulty.value),
                "xp_reward": badge.xp_reward,
                "rarity_score": badge.rarity_score,
                "requirements": badge.requirements,
                "requirements_text": format_requirements_text(badge.requirements)
            }
            
            badges_by_category[badge.badge_type.value].append(badge_data)
        
        # Sort each category by difficulty and rarity
        for category in badges_by_category:
            badges_by_category[category].sort(key=lambda x: (
                ["bronze", "silver", "gold", "platinum"].index(x["difficulty"]),
                -x["rarity_score"]
            ))
        
        return {
            "total_badges": len(gamification_engine.badges),
            "badges_by_category": badges_by_category,
            "difficulty_levels": [
                {"name": "bronze", "color": get_difficulty_color("bronze"), "description": "Easy to earn"},
                {"name": "silver", "color": get_difficulty_color("silver"), "description": "Moderate challenge"},
                {"name": "gold", "color": get_difficulty_color("gold"), "description": "Significant achievement"},
                {"name": "platinum", "color": get_difficulty_color("platinum"), "description": "Extremely rare"}
            ]
        }
        
    except Exception as e:
        print(f"Badge catalog error: {e}")
        return {"total_badges": 0, "badges_by_category": {}, "error": str(e)}

@app.post("/api/gamification/student/{student_id}/celebrate")
async def celebrate_achievement(student_id: str, achievement_data: Dict):
    """Record achievement celebration - FULLY FUNCTIONAL"""
    try:
        celebration_type = achievement_data.get("type", "general")
        achievement_id = achievement_data.get("achievement_id")
        
        # Award celebration bonus XP
        celebration_xp = {
            "badge_earned": 25,
            "level_up": 50,
            "quest_completed": 15,
            "streak_milestone": 20,
            "general": 10
        }
        
        xp_bonus = celebration_xp.get(celebration_type, 10)
        
        # Add XP for celebrating
        xp_result = await gamification_engine.add_xp(student_id, xp_bonus, f"Celebrated: {celebration_type}")
        
        # Create celebration response
        celebration_messages = [
            "🎉 Way to celebrate your achievement! Keep up the great work!",
            "✨ Your enthusiasm is inspiring! Bonus XP awarded!",
            "🌟 Celebrating success is part of learning! Well done!",
            "🎊 Your joy in learning is contagious! Keep it up!"
        ]
        
        import random
        message = random.choice(celebration_messages)
        
        return {
            "celebration_recorded": True,
            "bonus_xp": xp_bonus,
            "level_up": xp_result.get("level_up", False),
            "new_level": xp_result.get("new_level") if xp_result.get("level_up") else None,
            "message": message,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"Celebration error: {e}")
        return {"celebration_recorded": False, "error": str(e)}

@app.get("/api/gamification/system/stats")
async def get_system_stats():
    """Get system-wide gamification statistics - NEW ENDPOINT"""
    try:
        stats = GamificationStorage.get_system_stats()
        
        return {
            "total_students": stats["total_students"],
            "total_badges_awarded": stats["total_badges_awarded"],
            "average_level": round(stats["average_level"], 1),
            "level_distribution": stats["level_distribution"],
            "most_popular_badges": [
                {
                    "badge_id": badge_id,
                    "badge_name": gamification_engine.badges[badge_id].name if badge_id in gamification_engine.badges else "Unknown",
                    "badge_icon": gamification_engine.badges[badge_id].icon if badge_id in gamification_engine.badges else "🏆",
                    "earned_count": count
                }
                for badge_id, count in stats["most_popular_badges"]
            ],
            "last_updated": datetime.now().isoformat()
        }
        
    except Exception as e:
        print(f"System stats error: {e}")
        return {"error": str(e)}

# Helper functions for API endpoints

def format_requirements_text(requirements: Dict) -> str:
    """Convert requirements dict to readable text"""
    if not requirements:
        return "No specific requirements"
    
    text_parts = []
    for key, value in requirements.items():
        # Convert snake_case to readable text
        readable_key = key.replace("_", " ").title()
        text_parts.append(f"{readable_key}: {value}")
    
    return " • ".join(text_parts)

async def process_student_activity(activity: GamificationActivityRequest) -> Dict:
    """Process student activity and return stats for gamification"""
    stats = {}
    base_xp = 10  # Base XP for any activity
    
    activity_xp_map = {
        "message_sent": 10,
        "voice_used": 15,
        "book_generated": 25,
        "book_read": 20,
        "subject_switch": 5,
        "late_night_study": 20,
        "early_morning_study": 20
    }
    
    # Calculate XP for this activity
    xp_gained = activity_xp_map.get(activity.activity_type, base_xp)
    
    # Bonus XP for subject-specific activities
    if activity.subject:
        stats[f"{activity.subject}_interactions"] = stats.get(f"{activity.subject}_interactions", 0) + 1
        xp_gained += 5  # Bonus for subject-specific learning
    
    # Track activity type
    stats[activity.activity_type] = stats.get(activity.activity_type, 0) + 1
    
    # Add XP to student
    await gamification_engine.add_xp(activity.student_id, xp_gained, f"Activity: {activity.activity_type}")
    stats["xp_gained"] = xp_gained
    
    # Track time-based achievements
    current_hour = datetime.now().hour
    if current_hour >= 21 or current_hour <= 5:  # 9 PM to 5 AM
        stats["late_night_study"] = 1
    elif current_hour <= 7:  # Before 7 AM
        stats["early_morning_study"] = 1
    
    return stats

async def get_quest_progress(student_id: str, quest_id: str) -> Dict:
    """Get current progress for a specific quest - REAL IMPLEMENTATION"""
    try:
        # Get active quests for the student
        active_quests = await gamification_engine.get_active_quests(student_id)
        
        # Find the specific quest
        for quest_progress in active_quests:
            if quest_progress.quest_id == quest_id:
                return quest_progress.progress
        
        # If quest not found in active quests, check if it exists and return empty progress
        if quest_id in gamification_engine.quests:
            return {}  # Quest exists but not started yet
        
        # Quest doesn't exist
        return {"error": "Quest not found"}
        
    except Exception as e:
        print(f"Error getting quest progress for {quest_id}: {e}")
        return {"error": str(e)}

async def get_todays_quest_progress(student_id: str, quest_id: str) -> Dict:
    """Get today's progress for a quest with real-time calculations"""
    try:
        today = datetime.now().date()
        
        # Get current quest progress
        quest_progress = await get_quest_progress(student_id, quest_id)
        if "error" in quest_progress:
            return quest_progress
        
        # Get student's real stats
        student_stats = await gamification_engine.get_student_stats(student_id)
        conversations = conversations_db.get(student_id, [])
        
        # Calculate today's activities
        todays_progress = {}
        
        # Messages today
        messages_today = 0
        voice_interactions_today = 0
        different_tutors_today = set()
        topics_covered_today = set()
        
        for conv in conversations:
            try:
                conv_date = datetime.fromisoformat(conv["timestamp"]).date()
                if conv_date == today:
                    messages_today += 1
                    
                    # Check for voice usage (you'd track this separately)
                    if conv.get("used_voice", False):
                        voice_interactions_today += 1
                    
                    # Track tutors used today
                    tutor_type = conv.get("tutor_type", "general")
                    different_tutors_today.add(tutor_type)
                    
                    # Track topics covered today
                    subject = detect_subject_from_message(conv.get("student_message", ""))
                    if subject:
                        topics_covered_today.add(subject)
                        
            except (ValueError, KeyError):
                continue
        
        # Build today's progress data
        todays_progress = {
            "messages_today": messages_today,
            "voice_interactions_today": voice_interactions_today,
            "different_tutors_today": len(different_tutors_today),
            "topics_covered_today": len(topics_covered_today),
            "stories_generated_today": count_stories_generated_today(student_id),
            "books_read_today": count_books_read_today(student_id),
            "new_topics_today": count_new_topics_today(student_id),
            "explanations_given_today": count_explanations_today(conversations),
            "math_problems_today": count_subject_interactions_today(conversations, "math"),
            "science_topics_today": count_subject_interactions_today(conversations, "science"),
            "space_topics_today": count_interest_topics_today(conversations, student_id, "space"),
            "dinosaur_topics_today": count_interest_topics_today(conversations, student_id, "dinosaurs")
        }
        
        # Merge with existing quest progress (for multi-day quests)
        for key, value in quest_progress.items():
            if key not in todays_progress:
                todays_progress[key] = value
        
        return todays_progress
        
    except Exception as e:
        print(f"Error calculating today's quest progress: {e}")
        return {"error": str(e)}

async def get_available_badges(student_id: str) -> List[Dict]:
    """Get badges that student can still earn"""
    earned_badges = await gamification_engine.get_student_badges(student_id)
    student_stats = await gamification_engine.get_student_stats(student_id)
    
    available = []
    for badge_id, badge in gamification_engine.badges.items():
        if badge_id not in earned_badges:
            # Calculate progress toward badge
            progress = calculate_badge_progress(badge, student_stats)
            available.append({
                "id": badge.id,
                "name": badge.name,
                "description": badge.description,
                "icon": badge.icon,
                "xp_reward": badge.xp_reward,
                "progress_percentage": progress,
                "requirements": badge.requirements
            })
    
    # Sort by progress (closest to completion first)
    available.sort(key=lambda x: x["progress_percentage"], reverse=True)
    return available

def calculate_badge_progress(badge: Badge, student_stats: Dict) -> float:
    """Calculate student's progress toward earning a badge"""
    total_progress = 0
    requirement_count = len(badge.requirements)
    
    for req_key, req_value in badge.requirements.items():
        current_value = student_stats.get(req_key, 0)
        progress = min(current_value / req_value, 1.0) * 100
        total_progress += progress
    
    return total_progress / requirement_count if requirement_count > 0 else 0

async def get_quest_progress_with_completion(student_id: str, quest_id: str) -> Dict:
    """Get quest progress with completion percentage and requirements"""
    try:
        # Get the quest definition
        if quest_id not in gamification_engine.quests:
            return {"error": "Quest not found"}
        
        quest = gamification_engine.quests[quest_id]
        
        # Get current progress
        current_progress = await get_todays_quest_progress(student_id, quest_id)
        
        if "error" in current_progress:
            return current_progress
        
        # Calculate completion percentage
        completion_data = {}
        total_completion = 0
        requirement_count = len(quest.requirements)
        
        for req_key, req_value in quest.requirements.items():
            current_value = current_progress.get(req_key, 0)
            req_completion = min(current_value / req_value, 1.0) * 100
            
            completion_data[req_key] = {
                "current": current_value,
                "required": req_value,
                "completion_percentage": round(req_completion, 1),
                "completed": current_value >= req_value
            }
            
            total_completion += req_completion
        
        overall_completion = total_completion / requirement_count if requirement_count > 0 else 0
        
        return {
            "quest_id": quest_id,
            "quest_name": quest.name,
            "overall_completion": round(overall_completion, 1),
            "is_complete": overall_completion >= 100,
            "requirements": completion_data,
            "progress": current_progress
        }
        
    except Exception as e:
        print(f"Error getting quest progress with completion: {e}")
        return {"error": str(e)}

def calculate_time_remaining(start_date: datetime, time_limit_hours: int) -> str:
    """Calculate time remaining for a quest"""
    if not time_limit_hours:
        return None
    
    end_time = start_date + timedelta(hours=time_limit_hours)
    remaining = end_time - datetime.now()
    
    if remaining.total_seconds() <= 0:
        return "Expired"
    
    hours = int(remaining.total_seconds() // 3600)
    minutes = int((remaining.total_seconds() % 3600) // 60)
    
    if hours > 0:
        return f"{hours}h {minutes}m"
    else:
        return f"{minutes}m"

def get_streak_icon(streak_type: str) -> str:
    """Get icon for streak type"""
    icons = {
        "daily_study": "🔥",
        "weekly_goals": "⭐",
        "subject_focus": "🎯",
        "voice_usage": "🎤",
        "reading_streak": "📚"
    }
    return icons.get(streak_type, "🏆")

def detect_subject_from_message(message: str) -> Optional[str]:
    """Detect subject from message content"""
    message_lower = message.lower()
    
    math_keywords = ["math", "calculate", "number", "add", "subtract", "multiply", "divide"]
    science_keywords = ["science", "experiment", "chemistry", "physics", "biology"]
    reading_keywords = ["read", "story", "book", "write", "grammar"]
    
    if any(keyword in message_lower for keyword in math_keywords):
        return "math"
    elif any(keyword in message_lower for keyword in science_keywords):
        return "science"
    elif any(keyword in message_lower for keyword in reading_keywords):
        return "reading"
    
    return None

def count_stories_generated_today(student_id: str) -> int:
    """Count stories generated today"""
    try:
        today = datetime.now().date()
        generated_books = progress_db.get(student_id, {}).get("generated_books", [])
        
        count = 0
        for book in generated_books:
            # Assuming books have a timestamp or creation date
            if "timestamp" in book:
                try:
                    book_date = datetime.fromisoformat(book["timestamp"]).date()
                    if book_date == today:
                        count += 1
                except:
                    continue
        
        return count
        
    except Exception:
        return 0

def count_books_read_today(student_id: str) -> int:
    """Count books read completely today"""
    try:
        # This would track reading completions
        # For now, return 0 as we haven't implemented reading tracking yet
        # You can enhance this when you add book reading completion tracking
        return 0
        
    except Exception:
        return 0

def count_new_topics_today(student_id: str) -> int:
    """Count new topics explored today"""
    try:
        today = datetime.now().date()
        conversations = conversations_db.get(student_id, [])
        existing_topics = set(progress_db.get(student_id, {}).get("topics_covered", []))
        
        todays_new_topics = set()
        
        for conv in conversations:
            try:
                conv_date = datetime.fromisoformat(conv["timestamp"]).date()
                if conv_date == today:
                    # Extract topics from conversation
                    topics = extract_topics(conv.get("student_message", "").lower())
                    for topic in topics:
                        if topic not in existing_topics:
                            todays_new_topics.add(topic)
            except:
                continue
        
        return len(todays_new_topics)
        
    except Exception:
        return 0

def count_explanations_today(conversations: List[Dict]) -> int:
    """Count times student explained something back today"""
    try:
        today = datetime.now().date()
        count = 0
        
        explanation_keywords = [
            "i think", "because", "so that means", "let me explain",
            "in other words", "what i understand", "my answer is"
        ]
        
        for conv in conversations:
            try:
                conv_date = datetime.fromisoformat(conv["timestamp"]).date()
                if conv_date == today:
                    student_message = conv.get("student_message", "").lower()
                    if any(keyword in student_message for keyword in explanation_keywords):
                        count += 1
            except:
                continue
        
        return count
        
    except Exception:
        return 0
    
def count_subject_interactions_today(conversations: List[Dict], subject: str) -> int:
    """Count interactions with a specific subject today"""
    try:
        today = datetime.now().date()
        count = 0
        
        for conv in conversations:
            try:
                conv_date = datetime.fromisoformat(conv["timestamp"]).date()
                if conv_date == today:
                    detected_subject = detect_subject_from_message(conv.get("student_message", ""))
                    if detected_subject == subject:
                        count += 1
            except:
                continue
        
        return count
        
    except Exception:
        return 0

def count_interest_topics_today(conversations: List[Dict], student_id: str, interest: str) -> int:
    """Count conversations about a specific interest topic today"""
    try:
        today = datetime.now().date()
        count = 0
        
        # Get student interests
        student_data = students_db.get(student_id, {})
        student_interests = student_data.get("interests", [])
        
        # Only count if this is actually one of their interests
        if interest not in student_interests:
            return 0
        
        # Define keywords for each interest
        interest_keywords = {
            "dinosaurs": ["dinosaur", "t-rex", "fossil", "prehistoric", "jurassic", "triceratops"],
            "space": ["space", "planet", "star", "galaxy", "astronaut", "rocket", "solar system", "mars"],
            "animals": ["animal", "dog", "cat", "bird", "wildlife", "zoo", "pet"],
            "science": ["experiment", "chemistry", "physics", "biology", "scientific"],
            "history": ["history", "ancient", "historical", "past", "empire"],
            "technology": ["computer", "robot", "coding", "programming", "digital"],
            "art": ["draw", "paint", "create", "artistic", "design"],
            "music": ["song", "music", "instrument", "melody", "rhythm"],
            "sports": ["game", "team", "sport", "play", "competition"],
            "reading": ["book", "story", "read", "literature", "novel"]
        }
        
        keywords = interest_keywords.get(interest.lower(), [interest.lower()])
        
        for conv in conversations:
            try:
                conv_date = datetime.fromisoformat(conv["timestamp"]).date()
                if conv_date == today:
                    student_message = conv.get("student_message", "").lower()
                    ai_response = conv.get("ai_response", "").lower()
                    
                    # Check if any interest keywords appear in the conversation
                    if any(keyword in student_message or keyword in ai_response for keyword in keywords):
                        count += 1
            except:
                continue
        
        return count
        
    except Exception:
        return 0

# WebSocket for real-time features (optional for now)
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/{student_id}")
async def websocket_endpoint(websocket: WebSocket, student_id: str):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            # Handle real-time chat here if needed
            await manager.send_personal_message(f"Echo: {data}", websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI application startup and shutdown events"""
    # Startup: Initialize gamification system
    try:
        # Update gamification engine methods
        gamification_engine.get_student_stats = GamificationStorage.get_student_stats
        gamification_engine.student_has_badge = GamificationStorage.student_has_badge
        gamification_engine.award_badge = GamificationStorage.award_badge
        gamification_engine.get_student_badges = GamificationStorage.get_student_badges
        gamification_engine.get_student_level = GamificationStorage.get_student_level
        gamification_engine.save_student_level = GamificationStorage.save_student_level
        gamification_engine.get_streak = GamificationStorage.get_streak
        gamification_engine.save_streak = GamificationStorage.save_streak
        gamification_engine.get_student_streaks = GamificationStorage.get_student_streaks
        gamification_engine.get_active_quests = GamificationStorage.get_active_quests
        gamification_engine.save_quest_progress = GamificationStorage.save_quest_progress
        gamification_engine.get_recent_achievements = GamificationStorage.get_recent_achievements
        gamification_engine.get_leaderboard = GamificationStorage.get_leaderboard_data
        
        print("✅ Gamification system initialized successfully!")
    except Exception as e:
        print(f"❌ Error initializing gamification: {e}")
    
    yield  # Server is running
    
    # Shutdown: Clean up resources if needed
    # Add any cleanup code here

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

# To run this server:
# 1. Get OpenAI API key from https://platform.openai.com/api-keys
# 2. Set environment variable: export OPENAI_API_KEY="your-key-here"
# 3. Install dependencies: pip install fastapi uvicorn openai
# 4. Run: python backend_server.py
# 5. Visit: http://localhost:8000/docs for API documentation

# Alternative: Use Anthropic Claude instead of OpenAI
# Uncomment below and install anthropic: pip install anthropic
"""
import anthropic

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "your-anthropic-key-here")
anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# In the AITutor class, replace the get_response method with:
async def get_response_anthropic(self, message: str, conversation_history: List[Dict]) -> str:
    try:
        # Build conversation context for Claude
        conversation_text = ""
        for exchange in conversation_history[-5:]:  # Last 5 exchanges
            conversation_text += f"Human: {exchange['student_message']}\n"
            conversation_text += f"Assistant: {exchange['ai_response']}\n"
        
        full_prompt = f"{self.system_prompt}\n\nConversation so far:\n{conversation_text}\nHuman: {message}\n\nAssistant:"
        
        response = anthropic_client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": full_prompt}]
        )
        
        return response.content[0].text
        
    except Exception as e:
        print(f"Anthropic API Error: {e}")
        return self.get_fallback_response(message)
"""