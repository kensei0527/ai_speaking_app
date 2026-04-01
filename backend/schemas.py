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
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


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


class ChapterDetailResponse(ChapterResponse):
    weak_grammar_points: List[WeakPointInfo] = []
    recent_attempts: List[RecentAttemptInfo] = []


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
    feedback_text: str
    expected_english: str
    grammar_point: str
    alternative_expressions: List[str] = []   # ✨ Other valid English expressions
    naturalness_tips: List[str] = []          # ✨ Tips for more natural speaking


# ─── Lesson Schemas ───────────────────────────────────────────────────────────

class LessonStartRequest(BaseModel):
    chapter_id: int


class LessonQuestionInfo(BaseModel):
    id: int
    japanese_text: str
    expected_english_text: str
    grammar_point: str
    difficulty: int
    order_index: int

    model_config = ConfigDict(from_attributes=True)


class LessonResponse(BaseModel):
    lesson_id: int
    chapter_id: int
    questions: List[LessonQuestionInfo]
    total_questions: int

    model_config = ConfigDict(from_attributes=True)


class LessonAnswerItem(BaseModel):
    question_id: int
    user_answer: str


class LessonCompleteRequest(BaseModel):
    answers: List[LessonAnswerItem]


class LessonAnswerResult(BaseModel):
    question_id: int
    order_index: int
    japanese_text: str
    user_answer: str
    is_correct: bool
    score: float
    feedback_text: str
    expected_english: str
    grammar_point: str
    alternative_expressions: List[str] = []
    naturalness_tips: List[str] = []


class LessonCompleteResponse(BaseModel):
    lesson_id: int
    chapter_id: int
    total_questions: int
    correct_count: int
    accuracy_rate: float
    average_score: float
    chapter_mastered: bool = False
    next_chapter_unlocked: bool = False
    results: List[LessonAnswerResult]


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
    overall_level: str           # "Beginner" / "Intermediate" / "Advanced"
    overall_score: float
    chapters_mastered: int
    total_chapters: int
    total_attempts: int
    overall_accuracy: float
    weak_points: List[WeakPointInfo] = []
    chapter_progress: List[ChapterResponse] = []
