from typing import Dict, Any, List
from fastapi import HTTPException
from models.auth import UserAuth, UserInDB
from models.schema import Base
from sqlalchemy.orm import Session
import random
import uuid

class XPCalculator:
    @staticmethod
    async def calculate_activity_xp(student_id: str, activity_type: str, activity_data: Dict[str, Any]) -> Dict[str, Any]:
        base_xp = {
            "message_sent": 5,
            "voice_used": 10,
            "book_generated": 20,
            "chapter_completed": 30,
            "reading_session": 40
        }
        
        xp = base_xp.get(activity_type, 5)
        
        # Apply bonuses based on activity data
        if activity_type == "reading_session":
            accuracy = activity_data.get("accuracy_score", 0)
            wpm = activity_data.get("words_per_minute", 0)
            comprehension = activity_data.get("comprehension_score", 0)
            
            xp += int(accuracy * 0.5)  # Up to 50 bonus XP for perfect accuracy
            xp += int(min(wpm / 2, 50))  # Up to 50 bonus XP for reading speed
            xp += int(comprehension * 0.5)  # Up to 50 bonus XP for comprehension
        
        # Return both `xp_earned` (friendly name) and `total_xp` to
        # remain compatible with other parts of the code that expect
        # the `total_xp` key.
        return {
            "xp_earned": xp,
            "total_xp": xp,
            "activity_type": activity_type,
            "bonuses": activity_data
        }

class QuestGenerator:
    @staticmethod
    async def generate_personalized_quests(student_id: str) -> List[Dict[str, Any]]:
        quest_templates = [
            {
                "type": "reading_speed",
                "name": "Speed Reader",
                "description": "Read a chapter at {target} words per minute",
                "target": lambda: random.choice([100, 150, 200]),
                "xp_reward": 100
            },
            {
                "type": "accuracy",
                "name": "Perfect Pronunciation",
                "description": "Complete a reading with {target}% accuracy",
                "target": lambda: random.randint(90, 98),
                "xp_reward": 150
            },
            {
                "type": "comprehension",
                "name": "Deep Understanding",
                "description": "Achieve {target}% comprehension score",
                "target": lambda: random.randint(85, 95),
                "xp_reward": 200
            }
        ]
        
        quests = []
        for template in quest_templates:
            target = template["target"]()
            quests.append({
                "id": str(uuid.uuid4()),
                "name": template["name"],
                "description": template["description"].format(target=target),
                "type": template["type"],
                "target": target,
                "xp_reward": template["xp_reward"],
                "completed": False
            })
        
        return quests

async def get_student_rank(student_id: str, db: Session) -> Dict[str, Any]:
    """Calculate student's rank based on XP and achievements"""
    student = db.query(UserInDB).filter(UserInDB.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    
    # Get total XP from student's activities
    total_xp = 0  # Replace with actual XP calculation from database
    
    # Calculate rank based on XP thresholds
    ranks = [
        {"name": "Novice Reader", "min_xp": 0},
        {"name": "Book Explorer", "min_xp": 1000},
        {"name": "Story Seeker", "min_xp": 5000},
        {"name": "Chapter Champion", "min_xp": 10000},
        {"name": "Literature Legend", "min_xp": 50000}
    ]
    
    current_rank = ranks[0]
    for rank in ranks:
        if total_xp >= rank["min_xp"]:
            current_rank = rank
        else:
            break
    
    next_rank = None
    for rank in ranks:
        if rank["min_xp"] > total_xp:
            next_rank = rank
            break
    
    return {
        "current_rank": current_rank["name"],
        "next_rank": next_rank["name"] if next_rank else "Max Rank",
        "total_xp": total_xp,
        "xp_to_next": next_rank["min_xp"] - total_xp if next_rank else 0
    }