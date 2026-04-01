from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text, Float
from sqlalchemy.orm import relationship
import datetime
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, index=True)
    name = Column(String, index=True, default="Guest")
    proficiency_score = Column(Float, default=0.0)  # Overall weighted average (auto-calculated)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    attempts = relationship("Attempt", back_populates="user")
    chapter_progress = relationship("UserChapterProgress", back_populates="user")
    lessons = relationship("Lesson", back_populates="user")


class Chapter(Base):
    __tablename__ = "chapters"

    id = Column(Integer, primary_key=True, index=True)
    number = Column(Integer, unique=True, index=True)       # 1-10
    title = Column(String, nullable=False)                  # e.g. "自己紹介・挨拶"
    description = Column(Text, nullable=False)              # Chapter description
    grammar_points = Column(String, nullable=False)         # Comma-separated: "be動詞,人称代名詞"
    cefr_level = Column(String, nullable=False)             # "A1", "A2", "B1", etc.
    prerequisite_chapter = Column(Integer, nullable=True)   # Chapter number prerequisite (None for ch.1)

    questions = relationship("Question", back_populates="chapter")


class UserChapterProgress(Base):
    __tablename__ = "user_chapter_progress"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=False)
    proficiency_score = Column(Float, default=0.0)      # 0-100 per-chapter score
    total_attempts = Column(Integer, default=0)
    correct_attempts = Column(Integer, default=0)
    status = Column(String, default="locked")           # locked / available / in_progress / mastered
    last_attempted_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="chapter_progress")
    chapter = relationship("Chapter")


class Question(Base):
    __tablename__ = "questions"

    id = Column(Integer, primary_key=True, index=True)
    japanese_text = Column(String, index=True)
    expected_english_text = Column(String)
    grammar_point = Column(String, index=True)
    difficulty = Column(Integer, default=1)  # 1-5 scale
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    chapter = relationship("Chapter", back_populates="questions")


class Attempt(Base):
    __tablename__ = "attempts"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"))
    question_id = Column(Integer, ForeignKey("questions.id"))
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=True)  # Which lesson this attempt belongs to
    user_answer = Column(Text)
    is_correct = Column(Boolean, default=False)
    ai_feedback = Column(Text)
    alternative_expressions = Column(Text, nullable=True)  # JSON array of alternative expressions
    naturalness_tips = Column(Text, nullable=True)         # JSON array of naturalness tips
    score = Column(Float)           # Score out of 100 on this attempt
    grammar_point = Column(String, nullable=True)  # Denormalized for analytics
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=True)  # Denormalized
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    user = relationship("User", back_populates="attempts")
    question = relationship("Question")
    lesson = relationship("Lesson", back_populates="attempts")


class Lesson(Base):
    """A single lesson session containing multiple questions generated at once."""
    __tablename__ = "lessons"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    chapter_id = Column(Integer, ForeignKey("chapters.id"), nullable=False)
    status = Column(String, default="active")   # active / completed
    total_questions = Column(Integer, default=0)
    started_at = Column(DateTime, default=datetime.datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="lessons")
    chapter = relationship("Chapter")
    questions = relationship("LessonQuestion", back_populates="lesson", order_by="LessonQuestion.order_index")
    attempts = relationship("Attempt", back_populates="lesson")


class LessonQuestion(Base):
    """Junction table linking a Lesson to its ordered Questions."""
    __tablename__ = "lesson_questions"

    id = Column(Integer, primary_key=True, index=True)
    lesson_id = Column(Integer, ForeignKey("lessons.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    order_index = Column(Integer, nullable=False)  # 0-based order within lesson

    lesson = relationship("Lesson", back_populates="questions")
    question = relationship("Question")
