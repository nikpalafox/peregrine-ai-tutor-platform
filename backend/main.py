from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
import json
import uuid
from datetime import datetime
import asyncio
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from enum import Enum
import json

# You'll need to install: pip install fastapi uvicorn openai python-multipart
import openai
import os

app = FastAPI(title="Peregrine AI Tutor Platform")

# Enable CORS for frontend connection
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


# Configuration - Add your API key here or set as environment variable
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "your-openai-api-key-here")

# Debug: Check if API key is loaded
print(f"API Key loaded: {'Yes' if OPENAI_API_KEY and OPENAI_API_KEY != 'your-openai-api-key-here' else 'No'}")
print(f"API Key starts with: {OPENAI_API_KEY[:10] if OPENAI_API_KEY else 'None'}...")

openai.api_key = OPENAI_API_KEY

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
            
            return {
                "title": title,
                "content": chapter_text,
                "chapter_number": chapter_number,
                "topic": topic,
                "word_count": len(chapter_text.split()),
                "reading_time_minutes": max(1, len(chapter_text.split()) // 200)
            }
            
        except Exception as e:
            print(f"Book generation error: {e}")
            return {
                "title": f"Chapter {chapter_number}: Adventure Awaits",
                "content": f"This would be an amazing story about {topic} featuring {interests_str}! The book generator is having trouble right now, but imagine the exciting adventures we could create together!",
                "chapter_number": chapter_number,
                "topic": topic,
                "word_count": 50,
                "reading_time_minutes": 1
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

@app.get("/api/students/{student_id}")
async def get_student(student_id: str):
    """Get student profile"""
    if student_id not in students_db:
        raise HTTPException(status_code=404, detail="Student not found")
    return students_db[student_id]

@app.post("/api/chat")
async def chat_with_tutor(message: ChatMessage):  # Note: ChatMessage instead of Message
    """Enhanced chat endpoint with gamification tracking"""
    if message.student_id not in students_db:
        raise HTTPException(status_code=404, detail="Student not found")
    
    student = Student(**students_db[message.student_id])
    
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
async def generate_chapter(request: BookRequest):
    """Generate a custom chapter for the student"""
    if request.student_id not in students_db:
        raise HTTPException(status_code=404, detail="Student not found")
    
    student = Student(**students_db[request.student_id])
    
    # Get or create AI tutor for this student
    if request.student_id not in student_contexts:
        student_contexts[request.student_id] = AITutor(student)
    
    ai_tutor = student_contexts[request.student_id]
    chapter = await ai_tutor.book_generator.generate_chapter(
        request.topic, 
        request.chapter_number
    )
    
    # Store the generated chapter
    if "generated_books" not in progress_db[request.student_id]:
        progress_db[request.student_id]["generated_books"] = []
    
    progress_db[request.student_id]["generated_books"].append(chapter)
    
    return chapter

@app.get("/api/students/{student_id}/books")
async def get_student_books(student_id: str):
    """Get all books/chapters generated for a student"""
    if student_id not in students_db:
        raise HTTPException(status_code=404, detail="Student not found")
    
    return progress_db.get(student_id, {}).get("generated_books", [])

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