from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class UserAuth(BaseModel):
    email: EmailStr
    password: str

class UserCreate(UserAuth):
    name: str
    grade_level: int

class UserInDB(UserCreate):
    id: str
    created_at: datetime
    hashed_password: str
    
class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: Optional[str] = None
    email: Optional[str] = None

class TokenData(BaseModel):
    email: Optional[str] = None