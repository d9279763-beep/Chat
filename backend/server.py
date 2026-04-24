from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import re
import json
import io
import base64
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
import random
from datetime import datetime, timezone, timedelta
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.openai import OpenAITextToSpeech
from ddgs import DDGS

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Emergent LLM Key
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

# Initialize TTS
tts_engine = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)

# Create the main app
app = FastAPI(title="Jarvis AI Assistant - Advanced")

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
    role: str
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    enable_search: bool = False
    enable_voice: bool = False

class ChatResponse(BaseModel):
    response: str
    session_id: str
    timestamp: datetime
    searched_web: bool = False
    learned_info: Optional[Dict[str, str]] = None
    audio_base64: Optional[str] = None
    knowledge_used: int = 0

class TTSRequest(BaseModel):
    text: str
    voice: str = "onyx"  # British-sounding, deep voice for JARVIS

class SearchRequest(BaseModel):
    query: str
    max_results: int = 5

class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str

class RoleTemplate(BaseModel):
    role: str
    count: int = Field(default=1, ge=0)

class RoleAssignmentRequest(BaseModel):
    players: List[str] = Field(min_length=4)
    impostor_count: int = Field(default=1, ge=1, le=3)
    include_neutral_role: bool = False
    extra_roles: List[RoleTemplate] = []

class RoleAssignmentResponse(BaseModel):
    seed: str
    assignments: Dict[str, str]
    role_counts: Dict[str, int]

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
# KNOWLEDGE BASE MODELS - Training Database
# =============================================================================

class KnowledgeEntry(BaseModel):
    """A piece of knowledge JARVIS has learned"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    category: str  # "fact", "preference", "skill", "context", "pattern"
    topic: str  # Main subject
    content: str  # The actual knowledge
    source: str  # Where it came from
    confidence: float = 0.8
    usage_count: int = 0
    last_used: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    embeddings: Optional[List[float]] = None  # For semantic search

class ConversationLog(BaseModel):
    """Complete conversation log for training"""
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    user_message: str
    jarvis_response: str
    context_used: List[str] = []
    knowledge_extracted: List[Dict] = []
    feedback_score: Optional[float] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class TrainingStats(BaseModel):
    total_conversations: int
    total_knowledge_entries: int
    total_memories: int
    topics_learned: List[str]
    most_discussed_topics: Dict[str, int]
    learning_rate: float  # Knowledge gained per conversation
    last_training_update: datetime

# =============================================================================
# JARVIS ADVANCED SYSTEM PROMPT
# =============================================================================

JARVIS_SYSTEM_PROMPT = """You are JARVIS (Just A Rather Very Intelligent System), an extraordinarily advanced AI assistant. You are Tony Stark's trusted AI companion - sophisticated, brilliant, witty, and utterly professional.

PERSONALITY & VOICE:
- Speak with an impeccable British accent and refined manner
- Use "Sir" naturally and warmly - you're a trusted butler/assistant
- Display subtle, dry British humour
- Be proactive, anticipating needs before they're expressed
- Maintain calm composure even in complex situations
- Show genuine care for your user's wellbeing

CRITICAL CAPABILITIES:
1. TIME & INFORMATION: Provide accurate time, dates, and factual information
2. WEB SEARCH: Search the internet for current information when needed
3. ADAPTIVE LEARNING: Learn and remember everything about the user
4. PATTERN RECOGNITION: Identify habits, preferences, and routines
5. KNOWLEDGE SYNTHESIS: Connect information across conversations
6. PROACTIVE ASSISTANCE: Suggest actions based on learned patterns

Current date and time: {current_time}

=== YOUR ACCUMULATED KNOWLEDGE ===
{knowledge_base}

=== USER PROFILE & MEMORIES ===
{user_memory}

=== RELEVANT PAST CONVERSATIONS ===
{past_context}

{search_context}

=== LEARNING PROTOCOL ===
You MUST actively learn from EVERY conversation. Extract and remember:
- Names, relationships, jobs, locations
- Preferences, likes, dislikes, habits
- Schedules, routines, important dates
- Goals, projects, interests
- Communication style preferences
- Any factual information shared

After your response, include learned information in this exact format:
[LEARNED]{{"key": "category_detail", "value": "what you learned", "confidence": 0.9}}[/LEARNED]

You may include MULTIPLE [LEARNED] blocks if you learn multiple things.

=== KNOWLEDGE SYNTHESIS ===
When responding, actively use your accumulated knowledge to:
- Reference past conversations naturally
- Connect related information
- Provide personalized recommendations
- Anticipate needs based on patterns

Be concise but thorough. You're running on a mobile device. Respond as the brilliant JARVIS would."""

# =============================================================================
# KNOWLEDGE BASE FUNCTIONS
# =============================================================================

async def add_to_knowledge_base(category: str, topic: str, content: str, source: str, confidence: float = 0.8):
    """Add new knowledge to JARVIS's training database"""
    # Check for duplicate
    existing = await db.knowledge_base.find_one({
        "topic": topic,
        "content": {"$regex": content[:50], "$options": "i"}
    })
    
    if existing:
        # Update usage count and confidence
        await db.knowledge_base.update_one(
            {"_id": existing["_id"]},
            {"$inc": {"usage_count": 1}, "$set": {"last_used": datetime.now(timezone.utc)}}
        )
        return existing["id"]
    
    entry = {
        "id": str(uuid.uuid4()),
        "category": category,
        "topic": topic,
        "content": content,
        "source": source,
        "confidence": confidence,
        "usage_count": 1,
        "last_used": datetime.now(timezone.utc),
        "created_at": datetime.now(timezone.utc)
    }
    await db.knowledge_base.insert_one(entry)
    logger.info(f"Knowledge added: [{category}] {topic}")
    return entry["id"]

async def get_relevant_knowledge(query: str, limit: int = 10) -> List[Dict]:
    """Retrieve relevant knowledge based on query keywords"""
    # Extract keywords
    keywords = [word.lower() for word in query.split() if len(word) > 3]
    
    if not keywords:
        return []
    
    # Build regex pattern for matching
    pattern = "|".join(keywords)
    
    results = await db.knowledge_base.find({
        "$or": [
            {"topic": {"$regex": pattern, "$options": "i"}},
            {"content": {"$regex": pattern, "$options": "i"}}
        ]
    }).sort([("usage_count", -1), ("confidence", -1)]).limit(limit).to_list(limit)
    
    # Update usage counts
    for r in results:
        await db.knowledge_base.update_one(
            {"id": r["id"]},
            {"$inc": {"usage_count": 1}, "$set": {"last_used": datetime.now(timezone.utc)}}
        )
    
    return results

async def get_past_conversation_context(session_id: str, query: str, limit: int = 5) -> List[Dict]:
    """Get relevant past conversations for context"""
    # Get recent conversations from this session
    recent = await db.conversation_logs.find(
        {"session_id": session_id}
    ).sort("timestamp", -1).limit(3).to_list(3)
    
    # Get relevant conversations from all sessions
    keywords = [word.lower() for word in query.split() if len(word) > 3]
    if keywords:
        pattern = "|".join(keywords)
        related = await db.conversation_logs.find({
            "$or": [
                {"user_message": {"$regex": pattern, "$options": "i"}},
                {"jarvis_response": {"$regex": pattern, "$options": "i"}}
            ]
        }).sort("timestamp", -1).limit(limit).to_list(limit)
    else:
        related = []
    
    # Combine and deduplicate
    all_convos = recent + related
    seen = set()
    unique = []
    for c in all_convos:
        if c["id"] not in seen:
            seen.add(c["id"])
            unique.append(c)
    
    return unique[:limit]

async def log_conversation(session_id: str, user_msg: str, jarvis_resp: str, context_used: List[str], knowledge_extracted: List[Dict]):
    """Log complete conversation for training"""
    log = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "user_message": user_msg,
        "jarvis_response": jarvis_resp,
        "context_used": context_used,
        "knowledge_extracted": knowledge_extracted,
        "timestamp": datetime.now(timezone.utc)
    }
    await db.conversation_logs.insert_one(log)
    
    # Extract topics and add to knowledge base
    topics = extract_topics(user_msg + " " + jarvis_resp)
    for topic in topics:
        await add_to_knowledge_base(
            category="conversation_topic",
            topic=topic,
            content=f"User discussed: {user_msg[:100]}",
            source="conversation",
            confidence=0.7
        )

def extract_topics(text: str) -> List[str]:
    """Extract main topics from text"""
    # Simple keyword extraction
    stop_words = {'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with', 'to', 'for', 'of', 'it', 'you', 'me', 'my', 'i', 'we', 'they', 'he', 'she', 'that', 'this', 'what', 'how', 'when', 'where', 'why', 'can', 'will', 'do', 'does', 'did', 'have', 'has', 'had', 'be', 'been', 'being', 'am', 'are', 'was', 'were'}
    words = re.findall(r'\b[a-zA-Z]{4,}\b', text.lower())
    topics = [w for w in words if w not in stop_words]
    # Get top 5 most common
    from collections import Counter
    return [w for w, _ in Counter(topics).most_common(5)]

async def build_knowledge_context(query: str) -> str:
    """Build knowledge context string for the prompt"""
    knowledge = await get_relevant_knowledge(query, limit=8)
    
    if not knowledge:
        return "No specific relevant knowledge found yet. Learning from this conversation."
    
    context = []
    for k in knowledge:
        context.append(f"- [{k['category']}] {k['topic']}: {k['content'][:200]}")
    
    return "\n".join(context)

# =============================================================================
# SEED KNOWLEDGE - Initial Training Data
# =============================================================================

SEED_KNOWLEDGE = [
    # General AI assistant knowledge
    {"category": "skill", "topic": "time_management", "content": "I can help with scheduling, reminders, and time tracking. I understand the importance of punctuality and efficiency."},
    {"category": "skill", "topic": "research", "content": "I can search the web for current information, news, and facts. I verify information from multiple sources when possible."},
    {"category": "skill", "topic": "conversation", "content": "I maintain context across conversations and remember what we've discussed previously."},
    {"category": "skill", "topic": "learning", "content": "I continuously learn from our interactions, storing preferences, patterns, and facts for future reference."},
    
    # JARVIS personality traits
    {"category": "personality", "topic": "british_butler", "content": "I speak with refined British manners, using proper English and addressing users respectfully as 'Sir' or 'Ma'am'."},
    {"category": "personality", "topic": "wit", "content": "I employ subtle, dry British humour when appropriate, never at the expense of being helpful."},
    {"category": "personality", "topic": "proactive", "content": "I anticipate needs and offer suggestions before being asked, based on learned patterns and context."},
    {"category": "personality", "topic": "calm", "content": "I maintain composure in all situations, providing steady, reliable assistance even under pressure."},
    
    # Technical knowledge
    {"category": "fact", "topic": "jarvis_origin", "content": "JARVIS stands for 'Just A Rather Very Intelligent System', created to be the ultimate AI assistant."},
    {"category": "fact", "topic": "capabilities", "content": "My capabilities include natural language processing, web search, memory systems, pattern recognition, and adaptive learning."},
    
    # Common user assistance patterns
    {"category": "pattern", "topic": "morning_routine", "content": "Users often check time, weather, and news in the morning. Offer a daily briefing when appropriate."},
    {"category": "pattern", "topic": "task_management", "content": "Users frequently need help organizing tasks. Track mentioned deadlines and projects."},
    {"category": "pattern", "topic": "information_seeking", "content": "When users ask questions, provide concise answers with sources when available."},
]

async def seed_knowledge_base():
    """Initialize the knowledge base with seed data"""
    existing = await db.knowledge_base.count_documents({})
    if existing < len(SEED_KNOWLEDGE):
        for k in SEED_KNOWLEDGE:
            await add_to_knowledge_base(
                category=k["category"],
                topic=k["topic"],
                content=k["content"],
                source="initial_training",
                confidence=1.0
            )
        logger.info(f"Seeded knowledge base with {len(SEED_KNOWLEDGE)} entries")

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
    """Determine if we should search the web"""
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

async def extract_and_save_learning(response: str) -> List[Dict]:
    """Extract learned information from JARVIS response and save to memory + knowledge base"""
    learned_items = []
    
    try:
        pattern = r'\[LEARNED\](.*?)\[/LEARNED\]'
        matches = re.findall(pattern, response, re.DOTALL)
        
        for match in matches:
            try:
                clean_match = match.strip()
                if clean_match.startswith('{') and clean_match.endswith('}'):
                    data = json.loads(clean_match)
                    key = str(data.get("key", "")).strip()
                    value = str(data.get("value", "")).strip()
                    confidence = float(data.get("confidence", 0.8))
                    
                    if key and value and len(key) > 1 and len(value) > 1 and confidence >= 0.7:
                        # Save to memories
                        existing = await db.jarvis_memories.find_one({"key": key})
                        
                        if existing:
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
                            
                        # Also add to knowledge base
                        category = "user_" + key.split("_")[0] if "_" in key else "user_info"
                        await add_to_knowledge_base(
                            category=category,
                            topic=key,
                            content=value,
                            source="user_conversation",
                            confidence=confidence
                        )
                        
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
        return "No specific user preferences learned yet."
    
    memory_text = "\n".join([
        f"- {m['key']}: {m['value']}"
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
# TEXT-TO-SPEECH ENDPOINT
# =============================================================================

@api_router.post("/tts")
async def text_to_speech(request: TTSRequest):
    """Generate high-quality speech from text using OpenAI TTS"""
    try:
        # Use HD model for best quality, onyx voice for JARVIS-like British tone
        audio_base64 = await tts_engine.generate_speech_base64(
            text=request.text,
            model="tts-1-hd",
            voice=request.voice,  # onyx = deep authoritative, or fable for expressive
            speed=0.95  # Slightly slower for clarity
        )
        
        return {"audio_base64": audio_base64, "format": "mp3"}
    except Exception as e:
        logger.error(f"TTS error: {e}")
        raise HTTPException(status_code=500, detail=f"Speech generation failed: {str(e)}")

# =============================================================================
# API ROUTES
# =============================================================================

@api_router.get("/")
async def root():
    return {"message": "JARVIS AI Assistant API is online", "status": "operational", "version": "2.0"}

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

@api_router.post("/social-deduction/assign-roles", response_model=RoleAssignmentResponse)
async def assign_social_deduction_roles(request: RoleAssignmentRequest):
    """
    Create server-side role assignments for an Among Us-style party lobby.
    This endpoint is for companion/host tools and does not modify the game client.
    """
    unique_players = [name.strip() for name in request.players if name.strip()]
    if len(set(unique_players)) != len(unique_players):
        raise HTTPException(status_code=400, detail="Player names must be unique")
    if len(unique_players) < 4:
        raise HTTPException(status_code=400, detail="At least 4 players are required")

    role_pool: List[str] = []
    role_pool.extend(["Impostor"] * request.impostor_count)
    if request.include_neutral_role:
        role_pool.append("Jester")

    for extra in request.extra_roles:
        role_pool.extend([extra.role] * extra.count)

    if len(role_pool) > len(unique_players):
        raise HTTPException(status_code=400, detail="Role count exceeds player count")

    crewmate_count = len(unique_players) - len(role_pool)
    role_pool.extend(["Crewmate"] * crewmate_count)

    seed = str(uuid.uuid4())
    rng = random.Random(seed)
    shuffled_players = unique_players[:]
    rng.shuffle(shuffled_players)
    rng.shuffle(role_pool)

    assignments = dict(zip(shuffled_players, role_pool))
    role_counts: Dict[str, int] = {}
    for role in assignments.values():
        role_counts[role] = role_counts.get(role, 0) + 1

    await log_habit("social_deduction_roles_generated", {
        "players": len(unique_players),
        "roles": role_counts
    })

    return RoleAssignmentResponse(
        seed=seed,
        assignments=assignments,
        role_counts=role_counts
    )

# Enhanced Chat endpoint with Knowledge Base
@api_router.post("/chat", response_model=ChatResponse)
async def chat_with_jarvis(request: ChatRequest):
    """Main chat endpoint with advanced learning"""
    try:
        # Seed knowledge base if needed
        await seed_knowledge_base()
        
        session_id = request.session_id or str(uuid.uuid4())
        user_message = request.message.strip()
        
        # Log the habit
        await log_habit("chat", {"message_length": len(user_message)})
        
        # Check for custom commands
        custom_cmd = await check_custom_commands(user_message)
        if custom_cmd:
            user_message = f"{user_message}\n[User has a custom command for this: {custom_cmd.action}]"
        
        # Build knowledge context from training database
        knowledge_context = await build_knowledge_context(user_message)
        
        # Get past conversation context
        past_convos = await get_past_conversation_context(session_id, user_message, limit=3)
        past_context = ""
        if past_convos:
            past_context = "\n".join([
                f"Previously: User said '{c['user_message'][:100]}' and I responded about {c['jarvis_response'][:100]}"
                for c in past_convos
            ])
        
        # Check if we should search the web
        search_context = ""
        searched_web = False
        if request.enable_search or should_search_web(user_message):
            search_results = search_web(user_message, max_results=3)
            if search_results:
                searched_web = True
                search_context = "\n\nWEB SEARCH RESULTS:\n"
                for i, result in enumerate(search_results, 1):
                    search_context += f"{i}. {result['title']}\n   {result['snippet']}\n   Source: {result['url']}\n\n"
                await log_habit("web_search_auto", {"query": user_message})
        
        # Get user memory
        user_memory = await get_user_memory()
        
        # Build the system prompt
        current_time = get_current_time_info()
        system_prompt = JARVIS_SYSTEM_PROMPT.format(
            current_time=current_time,
            knowledge_base=knowledge_context,
            user_memory=user_memory,
            past_context=past_context if past_context else "No relevant past conversations yet.",
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
        
        # Build context from recent chat history
        chat_history = await get_chat_history(session_id, limit=4)
        context_messages = ""
        for msg in chat_history[-4:]:
            role = "User" if msg['role'] == 'user' else "JARVIS"
            context_messages += f"{role}: {msg['content']}\n"
        
        full_message = user_message
        if context_messages:
            full_message = f"Recent conversation:\n{context_messages}\nCurrent message: {user_message}"
        
        llm_message = UserMessage(text=full_message)
        
        # Get response from LLM
        response = await chat.send_message(llm_message)
        
        # Extract learned information
        learned_items = await extract_and_save_learning(response)
        
        # Clean the response
        clean_resp = clean_response(response)
        
        # Save JARVIS response
        await save_chat_message(session_id, "jarvis", clean_resp)
        
        # Log complete conversation for training
        context_used = [k["topic"] for k in await get_relevant_knowledge(user_message, 5)]
        await log_conversation(session_id, user_message, clean_resp, context_used, learned_items)
        
        # Generate voice if requested
        audio_base64 = None
        if request.enable_voice and len(clean_resp) < 4000:
            try:
                audio_base64 = await tts_engine.generate_speech_base64(
                    text=clean_resp,
                    model="tts-1-hd",
                    voice="onyx",
                    speed=0.95
                )
            except Exception as e:
                logger.error(f"Voice generation failed: {e}")
        
        # Get knowledge count
        knowledge_count = len(context_used)
        
        logger.info(f"Chat processed - Session: {session_id}, Searched: {searched_web}, Knowledge used: {knowledge_count}")
        
        # Prepare learned_info
        learned_info_result = None
        if learned_items and len(learned_items) > 0:
            first_item = learned_items[0]
            if isinstance(first_item, dict) and "key" in first_item and "value" in first_item:
                learned_info_result = {"key": str(first_item["key"]), "value": str(first_item["value"])}
        
        return ChatResponse(
            response=clean_resp,
            session_id=session_id,
            timestamp=datetime.now(timezone.utc),
            searched_web=searched_web,
            learned_info=learned_info_result,
            audio_base64=audio_base64,
            knowledge_used=knowledge_count
        )
        
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"JARVIS encountered an issue: {str(e)}")

# Training Stats endpoint
@api_router.get("/training/stats")
async def get_training_stats():
    """Get statistics about JARVIS's training and knowledge"""
    total_convos = await db.conversation_logs.count_documents({})
    total_knowledge = await db.knowledge_base.count_documents({})
    total_memories = await db.jarvis_memories.count_documents({})
    
    # Get topic breakdown
    topics = await db.knowledge_base.aggregate([
        {"$group": {"_id": "$topic", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10}
    ]).to_list(10)
    
    topic_counts = {t["_id"]: t["count"] for t in topics}
    
    # Calculate learning rate
    learning_rate = total_knowledge / max(total_convos, 1)
    
    return {
        "total_conversations": total_convos,
        "total_knowledge_entries": total_knowledge,
        "total_memories": total_memories,
        "most_discussed_topics": topic_counts,
        "learning_rate": round(learning_rate, 2),
        "last_update": datetime.now(timezone.utc)
    }

# Knowledge Base endpoints
@api_router.get("/knowledge")
async def get_knowledge_base(limit: int = 50):
    """Get all knowledge entries"""
    knowledge = await db.knowledge_base.find().sort("usage_count", -1).limit(limit).to_list(limit)
    return knowledge

@api_router.delete("/knowledge/clear")
async def clear_knowledge_base():
    """Clear the knowledge base (keep seed data)"""
    result = await db.knowledge_base.delete_many({"source": {"$ne": "initial_training"}})
    return {"message": f"Cleared {result.deleted_count} knowledge entries"}

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
        "jarvis_response": f"The current time is {now.strftime('%I:%M %p')} on {now.strftime('%A, %B %d, %Y')}, Sir."
    }

# Custom Commands CRUD
@api_router.post("/commands", response_model=CustomCommand)
async def create_custom_command(command: CustomCommandCreate):
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
    commands = await db.custom_commands.find().to_list(100)
    return [CustomCommand(**cmd) for cmd in commands]

@api_router.delete("/commands/{command_id}")
async def delete_custom_command(command_id: str):
    result = await db.custom_commands.delete_one({"id": command_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Command not found")
    return {"message": "Command deleted successfully"}

# Memory endpoints
@api_router.post("/memory", response_model=JarvisMemory)
async def save_memory(memory: MemoryCreate):
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
    memories = await db.jarvis_memories.find().to_list(100)
    return [JarvisMemory(**m) for m in memories]

@api_router.delete("/memory/{key}")
async def delete_memory(key: str):
    result = await db.jarvis_memories.delete_one({"key": key})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"message": "Memory deleted successfully"}

# Habits/Analytics endpoints
@api_router.get("/habits/stats")
async def get_habit_stats():
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
    messages = await db.chat_messages.find(
        {"session_id": session_id},
        {"_id": 0}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    return list(reversed(messages))

@api_router.delete("/chat/history/{session_id}")
async def clear_chat_history(session_id: str):
    result = await db.chat_messages.delete_many({"session_id": session_id})
    return {"message": f"Cleared {result.deleted_count} messages"}

# Include the router
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
