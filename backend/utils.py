from typing import Dict, Any
import math

def format_xp_display(xp: int) -> str:
    """Format XP numbers for display (e.g., 1.2K, 45.3K, 1.1M)"""
    if xp < 1000:
        return str(xp)
    elif xp < 1000000:
        return f"{xp/1000:.1f}K"
    else:
        return f"{xp/1000000:.1f}M"

def get_difficulty_color(difficulty: str) -> str:
    """Get color code for difficulty levels"""
    colors = {
        "bronze": "#CD7F32",
        "silver": "#C0C0C0",
        "gold": "#FFD700",
        "platinum": "#E5E4E2"
    }
    return colors.get(difficulty.lower(), "#808080")

def create_achievement_notification(notification_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Create a standardized notification object for achievements"""
    templates = {
        "badge_earned": {
            "title": "New Badge Earned!",
            "message": f"You earned the {data.get('name', 'unknown')} badge!"
        },
        "level_up": {
            "title": "Level Up!",
            "message": f"You reached level {data.get('new_level', 0)}!"
        },
        "quest_completed": {
            "title": "Quest Completed!",
            "message": f"You completed the quest: {data.get('name', 'unknown')}"
        },
        "streak_milestone": {
            "title": "Streak Milestone!",
            "message": f"You maintained a {data.get('days', 0)} day streak!"
        }
    }
    
    notification = templates.get(notification_type, {
        "title": "Achievement Unlocked!",
        "message": "You accomplished something special!"
    })
    
    return {
        "type": notification_type,
        "title": notification["title"],
        "message": notification["message"],
        "data": data,
        "read": False
    }