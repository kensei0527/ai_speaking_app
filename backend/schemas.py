from pydantic import BaseModel, ConfigDict
from datetime import datetime
from typing import Optional, List


# User Schemas
class UserBase(BaseModel):
    name: str
    email: str


class UserCreate(UserBase):
    id: str  # Supabase UUID


class UserResponse(UserBase):
    id: str  # Supabase UUID
    proficiency_score: float
    cefr_level: str = "A1"
    placement_status: str = "pending"
    placement_score: Optional[float] = None
    placement_completed_at: Optional[datetime] = None
    recommended_chapter_id: Optional[int] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class UserUpdateRequest(BaseModel):
    name: str


# Chapter Schemas
class ChapterResponse(BaseModel):
    id: int
    number: int
    title: str
    description: str
    grammar_points: str
    cefr_level: str
    # User-specific progress fields (filled per request)
    status: str = "locked"
    proficiency_score: float = 0.0
    total_attempts: int = 0
    accuracy_rate: float = 0.0

    model_config = ConfigDict(from_attributes=True)


class WeakPointInfo(BaseModel):
    grammar_point: str
    attempts: int
    accuracy: float


class RecentAttemptInfo(BaseModel):
    question_japanese: str
    user_answer: str
    is_correct: bool
    score: float
    grammar_point: str
    created_at: datetime


class ScenarioResponse(BaseModel):
    id: int
    chapter_id: int
    title: str
    description: Optional[str] = None
    order_index: int
    # User progress fields
    status: str = "locked"  # locked / available / completed
    proficiency_score: float = 0.0
    total_attempts: int = 0
    correct_attempts: int = 0

    model_config = ConfigDict(from_attributes=True)


class ChapterDetailResponse(ChapterResponse):
    weak_grammar_points: List[WeakPointInfo] = []
    recent_attempts: List[RecentAttemptInfo] = []
    scenarios: List[ScenarioResponse] = []


# Question Schemas
class QuestionBase(BaseModel):
    japanese_text: str
    expected_english_text: str
    grammar_point: str
    difficulty: int


class QuestionCreate(QuestionBase):
    pass


class QuestionResponse(QuestionBase):
    id: int
    chapter_id: Optional[int] = None
    scenario_id: Optional[int] = None
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


# Attempt / Evaluation Schemas
class AnswerSubmit(BaseModel):
    question_id: int
    user_answer: str
    lesson_id: Optional[int] = None  # Optional: attach to a lesson


class EvaluationResponse(BaseModel):
    is_correct: bool
    score: float
    evaluation_level: str                         # ✨ "Perfect", "Great", "Good", "Try Again"
    feedback_text: str
    expected_english: str
    grammar_point: str
    alternative_expressions: List[str] = []   # ✨ Other valid English expressions
    naturalness_tips: List[str] = []          # ✨ Tips for more natural speaking


# ─── Lesson Schemas ───────────────────────────────────────────────────────────

class LessonStartRequest(BaseModel):
    scenario_id: int


class LessonIntroPhrase(BaseModel):
    phrase: str
    meaning: str
    usage_note: str
    example: str


class LessonIntro(BaseModel):
    title: str
    body: str
    phrases: List[LessonIntroPhrase] = []


class LessonQuestionInfo(BaseModel):
    id: int
    japanese_text: str
    grammar_point: str
    difficulty: int
    order_index: int

    model_config = ConfigDict(from_attributes=True)


class LessonResponse(BaseModel):
    lesson_id: int
    chapter_id: int
    scenario_id: Optional[int] = None
    is_review: bool = False
    lesson_intro: Optional[LessonIntro] = None
    questions: List[LessonQuestionInfo]
    total_questions: int

    model_config = ConfigDict(from_attributes=True)


class LessonAnswerItem(BaseModel):
    question_id: int
    user_answer: str


class LessonReviewRequest(BaseModel):
    mode: str = "weak"  # "weak" (<= 50 score) or "all"


class LessonCompleteRequest(BaseModel):
    answers: List[LessonAnswerItem]


class LessonAnswerResult(BaseModel):
    question_id: int
    order_index: int
    japanese_text: str
    user_answer: str
    is_correct: bool
    score: float
    evaluation_level: str
    feedback_text: str
    expected_english: str
    grammar_point: str
    alternative_expressions: List[str] = []
    naturalness_tips: List[str] = []


class LessonCompleteResponse(BaseModel):
    lesson_id: int
    chapter_id: int
    scenario_id: Optional[int] = None
    total_questions: int
    correct_count: int
    accuracy_rate: float
    average_score: float
    chapter_mastered: bool = False
    next_chapter_unlocked: bool = False
    results: List[LessonAnswerResult]


# ─── Lesson History Schemas ───────────────────────────────────────────────────

class LessonHistoryItem(BaseModel):
    """レッスン履歴一覧の1件分"""
    lesson_id: int
    chapter_id: int
    chapter_number: int
    chapter_title: str
    scenario_id: Optional[int] = None
    scenario_title: Optional[str] = None
    is_review: bool = False
    total_questions: int
    correct_count: int
    accuracy_rate: float
    average_score: float
    completed_at: datetime


class LessonDetailAnswer(BaseModel):
    """レッスン詳細内の1問分の解答情報"""
    order_index: int
    japanese_text: str
    expected_english: str
    user_answer: str
    is_correct: bool
    score: float
    evaluation_level: str
    feedback_text: str
    grammar_point: Optional[str] = None
    alternative_expressions: List[str] = []
    naturalness_tips: List[str] = []


class LessonDetailResponse(BaseModel):
    """レッスン詳細（全問題と解答を含む）"""
    lesson_id: int
    chapter_id: int
    chapter_number: int
    chapter_title: str
    scenario_id: Optional[int] = None
    scenario_title: Optional[str] = None
    is_review: bool = False
    total_questions: int
    correct_count: int
    accuracy_rate: float
    average_score: float
    completed_at: datetime
    answers: List[LessonDetailAnswer]


# API endpoint inputs
class GenerateQuestionRequest(BaseModel):
    chapter_id: int  # Required: which chapter to generate from
    topic: Optional[str] = None


# ─── Skill Report Schemas ─────────────────────────────────────────────────────

class GrammarSkill(BaseModel):
    grammar_point: str
    attempts: int
    accuracy: float
    chapter_title: str


class SkillReport(BaseModel):
    strong_skills: List[GrammarSkill]   # Top 3 strong grammar points
    weak_skills: List[GrammarSkill]     # Top 3 weak grammar points
    chapter_scores: List[dict]          # [{chapter_title, score, status}]
    ai_summary: str                     # AI-generated summary of user's skill profile


# Enhanced user stats
class UserStatsResponse(BaseModel):
    overall_level: str           # CEFR level: "A1" / "A2" / "B1" / "B2" / "C1" / "C2"
    overall_score: float
    cefr_level: str = "A1"
    placement_status: str = "pending"
    placement_score: Optional[float] = None
    recommended_chapter_id: Optional[int] = None
    chapters_mastered: int
    total_chapters: int
    total_attempts: int
    overall_accuracy: float
    weak_points: List[WeakPointInfo] = []
    chapter_progress: List[ChapterResponse] = []


# ─── Placement Schemas ───────────────────────────────────────────────────────

class PlacementQuestionInfo(BaseModel):
    id: int
    cefr_level: str
    japanese_text: str
    grammar_point: str
    difficulty: int
    order_index: int

    model_config = ConfigDict(from_attributes=True)


class PlacementStartResponse(BaseModel):
    session_id: int
    questions: List[PlacementQuestionInfo]
    total_questions: int


class PlacementAnswerItem(BaseModel):
    question_id: int
    user_answer: str


class PlacementCompleteRequest(BaseModel):
    answers: List[PlacementAnswerItem]


class PlacementBandScore(BaseModel):
    cefr_level: str
    average_score: float
    question_count: int


class PlacementCompleteResponse(BaseModel):
    session_id: int
    cefr_level: str
    placement_score: float
    recommended_chapter_id: Optional[int] = None
    band_scores: List[PlacementBandScore]


# ─── Conversation Evaluation Schemas ──────────────────────────────────────────

class TranscriptEntry(BaseModel):
    role: str
    text: str

class ConversationEvaluationRequest(BaseModel):
    transcript: List[TranscriptEntry]

class ConversationEvaluationResponse(BaseModel):
    overall_score: float
    summary: str
    strengths: List[str]
    improvement_areas: List[str]
    alternative_phrases: List[str]
