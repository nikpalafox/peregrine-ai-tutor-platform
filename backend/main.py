from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional
import json
import uuid
from datetime import datetime
import asyncio

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

class BookRequest(BaseModel):
    student_id: str
    topic: str
    chapter_number: int = 1

class ChatResponse(BaseModel):
    response: str
    student_id: str
    timestamp: str

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
student_contexts = {}  # Store AI conversation context for each student

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
async def chat_with_tutor(message: ChatMessage):
    """Send message to AI tutor and get response"""
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
    
    # Update progress tracking
    progress_db[message.student_id]["total_messages"] += 1
    progress_db[message.student_id]["last_active"] = datetime.now().isoformat()
    
    # Extract topics for progress tracking
    topics = extract_topics(message.content.lower())
    for topic in topics:
        if topic not in progress_db[message.student_id]["topics_covered"]:
            progress_db[message.student_id]["topics_covered"].append(topic)
    
    return ChatResponse(
        response=ai_response,
        student_id=message.student_id,
        timestamp=conversation_entry["timestamp"]
    )

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