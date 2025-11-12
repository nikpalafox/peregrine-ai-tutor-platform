from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class Chapter(BaseModel):
    id: str
    student_id: str
    title: str
    content: str
    created_at: datetime
    last_read_at: Optional[datetime]
    reading_progress: float = 0  # 0-100%
    reading_scores: List[float] = []  # Store comprehension scores
    
class ReadingSession(BaseModel):
    id: str
    chapter_id: str
    student_id: str
    start_time: datetime
    end_time: Optional[datetime]
    accuracy_score: Optional[float]
    comprehension_score: Optional[float]
    words_per_minute: Optional[float]
    recorded_audio_url: Optional[str]