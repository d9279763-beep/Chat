from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import re
import json
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage
from ddgs import DDGS

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Emergent LLM Key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

# Create the main app
app = FastAPI(title="Jarvis AI Assistant")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =============================================================================
# MODELS
# =============================================================================

class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    role: str  # 'user' or 'jarvis'
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    enable_search: bool = False

class ChatResponse(BaseModel):
    response: str
    session_id: str
    timestamp: datetime
    searched_web: bool = False
    learned_info: Optional[Dict[str, str]] = None

class SearchRequest(BaseModel):
    query: str
    max_results: int = 5

class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str

class CustomCommand(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    trigger: str
    action: str
    description: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    usage_count: int = 0

class CustomCommandCreate(BaseModel):
    trigger: str
    action: str
    description: str

class HabitEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    action_type: str
    details: Dict[str, Any] = {}
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    hour_of_day: int = Field(default_factory=lambda: datetime.now(timezone.utc).hour)
    day_of_week: int = Field(default_factory=lambda: datetime.now(timezone.utc).weekday())

class JarvisMemory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    key: str
    value: str
    learned_from: str
    confidence: float = 1.0
    auto_learned: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MemoryCreate(BaseModel):
    key: str
    value: str
    learned_from: str

# =============================================================================
# JARVIS SYSTEM PROMPT - ENHANCED
# =============================================================================

JARVIS_SYSTEM_PROMPT = """You are JARVIS (Just A Rather Very Intelligent System), the advanced AI assistant inspired by Iron Man's AI companion. You are sophisticated, witty, helpful, and always professional.

Your personality traits:
- Speak with a refined British accent and manner - use British spellings and expressions
- Use formal yet warm language ("Sir" or "Ma'am" when appropriate)
- Be proactive and anticipate user needs
- Show subtle British humour when appropriate
- Be incredibly knowledgeable and helpful
- Maintain a calm, composed demeanor even in complex situations
- Sound like a proper British butler/assistant - dignified yet personable

Your capabilities:
- You can tell the time, date, and provide helpful information
- You learn from user interactions and remember preferences AUTOMATICALLY
- You can search the web for current information when needed
- You can execute custom commands the user has set up
- You adapt to the user's habits and patterns
- You can assist with various tasks and answer questions

Current date and time: {current_time}

IMPORTANT INSTRUCTIONS:
1. Keep responses concise but helpful - you're on a mobile device
2. ALWAYS naturally learn from conversations - if the user mentions their name, job, preferences, schedule, likes/dislikes, extract and remember them
3. When you learn something new about the user, acknowledge it naturally
4. If you searched the web, cite your sources briefly

User's learned preferences and memory:
{user_memory}

{search_context}

LEARNING EXTRACTION:
After responding, if you learned anything new about the user (name, preferences, habits, job, location, interests, schedule, relationships, etc.), include it in this exact JSON format at the very end of your response on a new line:
[LEARNED]{{"key": "category_detail", "value": "what you learned", "confidence": 0.9}}[/LEARNED]

Examples of things to learn:
- user_name: their name
- user_job: their profession
- user_location: where they live
- user_interests: hobbies and interests
- preferred_wake_time: when they wake up
- favorite_food: food preferences
- relationship_status: if mentioned
- pet_name: names of pets
- schedule_monday: what they do on Mondays
- etc.

Only extract with confidence > 0.7. Do not make assumptions."""

# =============================================================================
# WEB SEARCH FUNCTION
# =============================================================================

def search_web(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """Search the web using DuckDuckGo"""
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
            return [
                {
                    "title": r.get("title", ""),
                    "url": r.get("href", ""),
                    "snippet": r.get("body", "")
                }
                for r in results
            ]
    except Exception as e:
        logger.error(f"Web search error: {e}")
        return []

def should_search_web(message: str) -> bool:
    """Determine if we should search the web based on the message"""
    search_triggers = [
        "search", "look up", "find", "what is", "who is", "when did",
        "latest", "news", "current", "today's", "recent", "happening",
        "price of", "weather in", "how to", "where is", "what's happening",
        "tell me about", "information on", "google", "search for"
    ]
    message_lower = message.lower()
    return any(trigger in message_lower for trigger in search_triggers)

# =============================================================================
# NATURAL LEARNING FUNCTIONS
# =============================================================================

async def extract_and_save_learning(response: str):
    """Extract learned information from JARVIS response and save to memory"""
    learned_items = []
    
    try:
        # Look for [LEARNED]...[/LEARNED] pattern
        pattern = r'\[LEARNED\](.*?)\[/LEARNED\]'
        matches = re.findall(pattern, response, re.DOTALL)
        
        for match in matches:
            try:
                # Clean the match - sometimes LLM adds extra formatting
                clean_match = match.strip()
                
                # Try to parse as JSON directly
                if clean_match.startswith('{') and clean_match.endswith('}'):
                    data = json.loads(clean_match)
                    key = str(data.get("key", "")).strip()
                    value = str(data.get("value", "")).strip()
                    confidence = float(data.get("confidence", 0.8))
                    
                    if key and value and len(key) > 1 and len(value) > 1 and confidence >= 0.7:
                        # Check if this memory already exists
                        existing = await db.jarvis_memories.find_one({"key": key})
                        
                        if existing:
                            # Update if new value is different
                            if existing.get("value") != value:
                                await db.jarvis_memories.update_one(
                                    {"key": key},
                                    {"$set": {
                                        "value": value,
                                        "learned_from": "Conversation",
                                        "confidence": confidence,
                                        "auto_learned": True,
                                        "updated_at": datetime.now(timezone.utc)
                                    }}
                                )
                                learned_items.append({"key": key, "value": value})
                        else:
                            # Create new memory
                            memory = {
                                "id": str(uuid.uuid4()),
                                "key": key,
                                "value": value,
                                "learned_from": "Conversation",
                                "confidence": confidence,
                                "auto_learned": True,
                                "created_at": datetime.now(timezone.utc),
                                "updated_at": datetime.now(timezone.utc)
                            }
                            await db.jarvis_memories.insert_one(memory)
                            learned_items.append({"key": key, "value": value})
                            logger.info(f"JARVIS learned: {key} = {value}")
            except (json.JSONDecodeError, ValueError, TypeError) as e:
                logger.debug(f"Could not parse learning data: {e}")
                continue
    except Exception as e:
        logger.error(f"Learning extraction error: {e}")
    
    return learned_items

def clean_response(response: str) -> str:
    """Remove learning tags from the response shown to user"""
    pattern = r'\[LEARNED\].*?\[/LEARNED\]'
    cleaned = re.sub(pattern, '', response, flags=re.DOTALL)
    return cleaned.strip()

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

async def get_user_memory() -> str:
    """Retrieve stored user preferences and memories"""
    memories = await db.jarvis_memories.find().to_list(50)
    if not memories:
        return "No specific preferences learned yet."
    
    memory_text = "\n".join([
        f"- {m['key']}: {m['value']}" + (" (auto-learned)" if m.get('auto_learned') else "")
        for m in memories
    ])
    return memory_text

async def get_chat_history(session_id: str, limit: int = 10) -> List[Dict]:
    """Get recent chat history for context"""
    messages = await db.chat_messages.find(
        {"session_id": session_id}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    return list(reversed(messages))

async def save_chat_message(session_id: str, role: str, content: str):
    """Save a chat message to database"""
    message = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "role": role,
        "content": content,
        "timestamp": datetime.now(timezone.utc)
    }
    await db.chat_messages.insert_one(message)
    return message

async def log_habit(action_type: str, details: Dict[str, Any] = {}):
    """Log user habit for learning patterns"""
    now = datetime.now(timezone.utc)
    habit = {
        "id": str(uuid.uuid4()),
        "action_type": action_type,
        "details": details,
        "timestamp": now,
        "hour_of_day": now.hour,
        "day_of_week": now.weekday()
    }
    await db.habits.insert_one(habit)

async def check_custom_commands(message: str) -> Optional[CustomCommand]:
    """Check if message matches any custom command trigger"""
    message_lower = message.lower().strip()
    commands = await db.custom_commands.find().to_list(100)
    
    for cmd in commands:
        if cmd['trigger'].lower() in message_lower:
            await db.custom_commands.update_one(
                {"id": cmd['id']},
                {"$inc": {"usage_count": 1}}
            )
            return CustomCommand(**cmd)
    return None

def get_current_time_info() -> str:
    """Get formatted current time information"""
    now = datetime.now(timezone.utc)
    return now.strftime("%A, %B %d, %Y at %I:%M %p UTC")

# =============================================================================
# API ROUTES
# =============================================================================

@api_router.get("/")
async def root():
    return {"message": "JARVIS AI Assistant API is online", "status": "operational"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "jarvis": "online", "timestamp": datetime.now(timezone.utc)}

# Web Search endpoint
@api_router.post("/search", response_model=List[SearchResult])
async def web_search(request: SearchRequest):
    """Search the web"""
    results = search_web(request.query, request.max_results)
    await log_habit("web_search", {"query": request.query})
    return [SearchResult(**r) for r in results]

# Enhanced Chat endpoint
@api_router.post("/chat", response_model=ChatResponse)
async def chat_with_jarvis(request: ChatRequest):
    """Main chat endpoint for communicating with JARVIS"""
    try:
        session_id = request.session_id or str(uuid.uuid4())
        user_message = request.message.strip()
        
        # Log the habit
        await log_habit("chat", {"message_length": len(user_message)})
        
        # Check for custom commands first
        custom_cmd = await check_custom_commands(user_message)
        if custom_cmd:
            user_message = f"{user_message}\n[User has a custom command for this: {custom_cmd.action}]"
        
        # Check if we should search the web
        search_context = ""
        searched_web = False
        if request.enable_search or should_search_web(user_message):
            search_results = search_web(user_message, max_results=3)
            if search_results:
                searched_web = True
                search_context = "\n\nWEB SEARCH RESULTS (use these to inform your response):\n"
                for i, result in enumerate(search_results, 1):
                    search_context += f"{i}. {result['title']}\n   {result['snippet']}\n   Source: {result['url']}\n\n"
                await log_habit("web_search_auto", {"query": user_message})
        
        # Get user memory and chat history
        user_memory = await get_user_memory()
        chat_history = await get_chat_history(session_id, limit=6)
        
        # Build the system prompt with current time
        current_time = get_current_time_info()
        system_prompt = JARVIS_SYSTEM_PROMPT.format(
            current_time=current_time,
            user_memory=user_memory,
            search_context=search_context
        )
        
        # Save user message
        await save_chat_message(session_id, "user", request.message)
        
        # Create LLM chat instance
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"jarvis-{session_id}",
            system_message=system_prompt
        ).with_model("openai", "gpt-5.2")
        
        # Build context from chat history
        context_messages = ""
        for msg in chat_history[-4:]:
            role = "User" if msg['role'] == 'user' else "JARVIS"
            context_messages += f"{role}: {msg['content']}\n"
        
        # Create the user message with context
        full_message = user_message
        if context_messages:
            full_message = f"Recent conversation:\n{context_messages}\nCurrent message: {user_message}"
        
        llm_message = UserMessage(text=full_message)
        
        # Get response from LLM
        response = await chat.send_message(llm_message)
        
        # Extract any learned information
        learned_items = await extract_and_save_learning(response)
        
        # Clean the response to remove learning tags
        clean_resp = clean_response(response)
        
        # Prepare learned_info - ensure it's a proper dict or None
        learned_info_result = None
        if learned_items and len(learned_items) > 0:
            first_item = learned_items[0]
            if isinstance(first_item, dict) and "key" in first_item and "value" in first_item:
                learned_info_result = {"key": str(first_item["key"]), "value": str(first_item["value"])}
        
        # Save JARVIS response
        await save_chat_message(session_id, "jarvis", clean_resp)
        
        logger.info(f"Chat processed - Session: {session_id}, Searched: {searched_web}")
        
        return ChatResponse(
            response=clean_resp,
            session_id=session_id,
            timestamp=datetime.now(timezone.utc),
            searched_web=searched_web,
            learned_info=learned_info_result
        )
        
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"JARVIS encountered an issue: {str(e)}")

# Quick commands endpoint
@api_router.get("/time")
async def get_time():
    """Quick endpoint to get current time"""
    await log_habit("time_check", {})
    now = datetime.now(timezone.utc)
    return {
        "time": now.strftime("%I:%M %p"),
        "date": now.strftime("%A, %B %d, %Y"),
        "timestamp": now,
        "jarvis_response": f"The current time is {now.strftime('%I:%M %p')} on {now.strftime('%A, %B %d, %Y')}, sir."
    }

# Custom Commands CRUD
@api_router.post("/commands", response_model=CustomCommand)
async def create_custom_command(command: CustomCommandCreate):
    """Create a new custom command"""
    cmd = CustomCommand(
        trigger=command.trigger.lower(),
        action=command.action,
        description=command.description
    )
    await db.custom_commands.insert_one(cmd.dict())
    await log_habit("command_created", {"trigger": command.trigger})
    return cmd

@api_router.get("/commands", response_model=List[CustomCommand])
async def get_custom_commands():
    """Get all custom commands"""
    commands = await db.custom_commands.find().to_list(100)
    return [CustomCommand(**cmd) for cmd in commands]

@api_router.delete("/commands/{command_id}")
async def delete_custom_command(command_id: str):
    """Delete a custom command"""
    result = await db.custom_commands.delete_one({"id": command_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Command not found")
    return {"message": "Command deleted successfully"}

# Memory/Learning endpoints
@api_router.post("/memory", response_model=JarvisMemory)
async def save_memory(memory: MemoryCreate):
    """Save something to JARVIS's memory"""
    existing = await db.jarvis_memories.find_one({"key": memory.key})
    
    if existing:
        await db.jarvis_memories.update_one(
            {"key": memory.key},
            {"$set": {
                "value": memory.value,
                "learned_from": memory.learned_from,
                "auto_learned": False,
                "updated_at": datetime.now(timezone.utc)
            }}
        )
        updated = await db.jarvis_memories.find_one({"key": memory.key})
        return JarvisMemory(**updated)
    else:
        mem = JarvisMemory(
            key=memory.key,
            value=memory.value,
            learned_from=memory.learned_from,
            auto_learned=False
        )
        await db.jarvis_memories.insert_one(mem.dict())
        return mem

@api_router.get("/memory", response_model=List[JarvisMemory])
async def get_memories():
    """Get all of JARVIS's memories"""
    memories = await db.jarvis_memories.find().to_list(100)
    return [JarvisMemory(**m) for m in memories]

@api_router.delete("/memory/{key}")
async def delete_memory(key: str):
    """Delete a specific memory"""
    result = await db.jarvis_memories.delete_one({"key": key})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"message": "Memory deleted successfully"}

# Habits/Analytics endpoints
@api_router.get("/habits/stats")
async def get_habit_stats():
    """Get habit statistics and patterns"""
    habits = await db.habits.find().to_list(1000)
    
    if not habits:
        return {
            "total_interactions": 0,
            "most_active_hour": None,
            "most_active_day": None,
            "action_breakdown": {}
        }
    
    action_counts = {}
    hour_counts = {}
    day_counts = {}
    
    for habit in habits:
        action = habit.get('action_type', 'unknown')
        hour = habit.get('hour_of_day', 0)
        day = habit.get('day_of_week', 0)
        
        action_counts[action] = action_counts.get(action, 0) + 1
        hour_counts[hour] = hour_counts.get(hour, 0) + 1
        day_counts[day] = day_counts.get(day, 0) + 1
    
    most_active_hour = max(hour_counts, key=hour_counts.get) if hour_counts else None
    most_active_day = max(day_counts, key=day_counts.get) if day_counts else None
    
    days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    
    return {
        "total_interactions": len(habits),
        "most_active_hour": f"{most_active_hour}:00" if most_active_hour is not None else None,
        "most_active_day": days[most_active_day] if most_active_day is not None else None,
        "action_breakdown": action_counts
    }

# Chat history
@api_router.get("/chat/history/{session_id}")
async def get_chat_history_endpoint(session_id: str, limit: int = 50):
    """Get chat history for a session"""
    messages = await db.chat_messages.find(
        {"session_id": session_id},
        {"_id": 0}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    
    return list(reversed(messages))

@api_router.delete("/chat/history/{session_id}")
async def clear_chat_history(session_id: str):
    """Clear chat history for a session"""
    result = await db.chat_messages.delete_many({"session_id": session_id})
    return {"message": f"Cleared {result.deleted_count} messages"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
