from __future__ import annotations

from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi.middleware.cors import CORSMiddleware
from collections import defaultdict
import datetime
import uvicorn
import os

import models, schemas, database, ai_service, auth

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="AI English Composition App", version="2.0.0")

# Configure CORS for Next.js frontend
origins = [
    "http://localhost:3000",
]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    origins.append(frontend_url)

# Allow all in Vercel preview environments if needed, but safe to default to localhost + specific host
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if os.getenv("VERCEL") == "1" else origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Startup: Seed chapters if empty ────────────────────────────────────────
@app.on_event("startup")
def startup_seed():
    db = database.SessionLocal()
    try:
        count = db.query(models.Chapter).count()
        if count == 0:
            from seed_chapters import seed
            seed()
    finally:
        db.close()


# ─── Helper: ensure user has chapter progress rows ──────────────────────────
def ensure_chapter_progress(user: models.User, db: Session):
    """Create UserChapterProgress rows for any chapters the user doesn't have yet."""
    chapters = db.query(models.Chapter).all()
    existing_chapter_ids = {
        p.chapter_id for p in
        db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user.id
        ).all()
    }

    for ch in chapters:
        if ch.id not in existing_chapter_ids:
            # Chapter 1 starts as available, rest are locked
            status = "available" if ch.number == 1 else "locked"
            progress = models.UserChapterProgress(
                user_id=user.id,
                chapter_id=ch.id,
                status=status,
            )
            db.add(progress)

    db.commit()


# ─── Helper: get weak grammar points for a chapter ──────────────────────────
def get_weak_points(user_id: str, chapter_id: int, db: Session) -> list[schemas.WeakPointInfo]:
    """Analyze attempts to find grammar points with low accuracy."""
    attempts = db.query(models.Attempt).filter(
        models.Attempt.user_id == user_id,
        models.Attempt.chapter_id == chapter_id,
        models.Attempt.grammar_point.isnot(None)
    ).all()

    if not attempts:
        return []

    # Group by grammar point
    stats = defaultdict(lambda: {"total": 0, "correct": 0})
    for a in attempts:
        stats[a.grammar_point]["total"] += 1
        if a.is_correct:
            stats[a.grammar_point]["correct"] += 1

    weak = []
    for gp, s in stats.items():
        accuracy = (s["correct"] / s["total"] * 100) if s["total"] > 0 else 0
        if accuracy < 70 or s["total"] < 3:  # Weak if <70% or too few attempts
            weak.append(schemas.WeakPointInfo(
                grammar_point=gp,
                attempts=s["total"],
                accuracy=round(accuracy, 1)
            ))

    # Sort by accuracy ascending (weakest first)
    weak.sort(key=lambda w: w.accuracy)
    return weak


# ─── Helper: check and unlock next chapter ───────────────────────────────────
def check_chapter_mastery(user_id: str, chapter_id: int, db: Session):
    """Check if a chapter should be marked as mastered and unlock next."""
    progress = db.query(models.UserChapterProgress).filter(
        models.UserChapterProgress.user_id == user_id,
        models.UserChapterProgress.chapter_id == chapter_id
    ).first()

    if not progress:
        return

    # Mastery condition: score >= 80 AND at least 10 attempts
    if progress.proficiency_score >= 80 and progress.total_attempts >= 10:
        if progress.status != "mastered":
            progress.status = "mastered"

            # Unlock next chapter
            current_chapter = db.query(models.Chapter).filter(
                models.Chapter.id == chapter_id
            ).first()
            if current_chapter:
                next_chapter = db.query(models.Chapter).filter(
                    models.Chapter.number == current_chapter.number + 1
                ).first()
                if next_chapter:
                    next_progress = db.query(models.UserChapterProgress).filter(
                        models.UserChapterProgress.user_id == user_id,
                        models.UserChapterProgress.chapter_id == next_chapter.id
                    ).first()
                    if next_progress and next_progress.status == "locked":
                        next_progress.status = "available"

            db.commit()


# ─── Helper: update overall proficiency ──────────────────────────────────────
def update_overall_proficiency(user: models.User, db: Session):
    """Recalculate overall proficiency as weighted average of chapter scores."""
    progress_list = db.query(models.UserChapterProgress).filter(
        models.UserChapterProgress.user_id == user.id,
        models.UserChapterProgress.total_attempts > 0
    ).all()

    if not progress_list:
        user.proficiency_score = 0.0
    else:
        total_weight = sum(p.total_attempts for p in progress_list)
        if total_weight > 0:
            weighted_sum = sum(p.proficiency_score * p.total_attempts for p in progress_list)
            user.proficiency_score = round(weighted_sum / total_weight, 1)
        else:
            user.proficiency_score = 0.0

    db.commit()


# ═══════════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/")
def read_root():
    return {"message": "Welcome to the AI English Composition API v2.0"}


@app.get("/api/users/me", response_model=schemas.UserResponse)
def get_me(user: models.User = Depends(auth.get_current_user)):
    return user


# ─── Chapters ────────────────────────────────────────────────────────────────

@app.get("/api/chapters", response_model=list[schemas.ChapterResponse])
def get_chapters(
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    """Get all chapters with user's progress status."""
    ensure_chapter_progress(user, db)

    chapters = db.query(models.Chapter).order_by(models.Chapter.number).all()
    progress_map = {
        p.chapter_id: p for p in
        db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user.id
        ).all()
    }

    result = []
    for ch in chapters:
        p = progress_map.get(ch.id)
        accuracy = 0.0
        if p and p.total_attempts > 0:
            accuracy = round(p.correct_attempts / p.total_attempts * 100, 1)

        result.append(schemas.ChapterResponse(
            id=ch.id,
            number=ch.number,
            title=ch.title,
            description=ch.description,
            grammar_points=ch.grammar_points,
            cefr_level=ch.cefr_level,
            status=p.status if p else "locked",
            proficiency_score=round(p.proficiency_score, 1) if p else 0.0,
            total_attempts=p.total_attempts if p else 0,
            accuracy_rate=accuracy,
        ))

    return result


@app.get("/api/chapters/{chapter_id}", response_model=schemas.ChapterDetailResponse)
def get_chapter_detail(
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    """Get chapter detail with weak points and recent attempts."""
    ensure_chapter_progress(user, db)

    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    progress = db.query(models.UserChapterProgress).filter(
        models.UserChapterProgress.user_id == user.id,
        models.UserChapterProgress.chapter_id == chapter_id
    ).first()

    accuracy = 0.0
    if progress and progress.total_attempts > 0:
        accuracy = round(progress.correct_attempts / progress.total_attempts * 100, 1)

    # Weak points analysis
    weak_points = get_weak_points(user.id, chapter_id, db)

    # Recent attempts (last 10)
    recent_raw = db.query(models.Attempt).filter(
        models.Attempt.user_id == user.id,
        models.Attempt.chapter_id == chapter_id
    ).order_by(models.Attempt.created_at.desc()).limit(10).all()

    recent_attempts = []
    for a in recent_raw:
        q = db.query(models.Question).filter(models.Question.id == a.question_id).first()
        recent_attempts.append(schemas.RecentAttemptInfo(
            question_japanese=q.japanese_text if q else "不明",
            user_answer=a.user_answer,
            is_correct=a.is_correct,
            score=a.score or 0,
            grammar_point=a.grammar_point or "不明",
            created_at=a.created_at,
        ))

    return schemas.ChapterDetailResponse(
        id=chapter.id,
        number=chapter.number,
        title=chapter.title,
        description=chapter.description,
        grammar_points=chapter.grammar_points,
        cefr_level=chapter.cefr_level,
        status=progress.status if progress else "locked",
        proficiency_score=round(progress.proficiency_score, 1) if progress else 0.0,
        total_attempts=progress.total_attempts if progress else 0,
        accuracy_rate=accuracy,
        weak_grammar_points=weak_points,
        recent_attempts=recent_attempts,
    )


# ─── Question Generation ─────────────────────────────────────────────────────

@app.post("/api/questions/generate", response_model=schemas.QuestionResponse)
def generate_question(
    req: schemas.GenerateQuestionRequest,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    """Generate a question for a specific chapter, considering user history."""
    ensure_chapter_progress(user, db)

    # Get chapter
    chapter = db.query(models.Chapter).filter(models.Chapter.id == req.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Check if chapter is accessible
    progress = db.query(models.UserChapterProgress).filter(
        models.UserChapterProgress.user_id == user.id,
        models.UserChapterProgress.chapter_id == req.chapter_id
    ).first()

    if progress and progress.status == "locked":
        raise HTTPException(status_code=403, detail="This chapter is still locked. Complete the previous chapter first.")

    # Mark as in_progress if currently available
    if progress and progress.status == "available":
        progress.status = "in_progress"
        db.commit()

    # Get user's recent attempts for this chapter
    recent_attempts = db.query(models.Attempt).filter(
        models.Attempt.user_id == user.id,
        models.Attempt.chapter_id == req.chapter_id
    ).order_by(models.Attempt.created_at.desc()).limit(10).all()

    user_history = [
        {
            "grammar_point": a.grammar_point or "不明",
            "is_correct": a.is_correct,
            "user_answer": a.user_answer,
        }
        for a in recent_attempts
    ]

    # Get weak points
    weak_point_infos = get_weak_points(user.id, req.chapter_id, db)
    weak_point_names = [wp.grammar_point for wp in weak_point_infos]

    # Generate via AI
    chapter_score = progress.proficiency_score if progress else 0.0
    q_data = ai_service.generate_question(
        chapter_title=chapter.title,
        chapter_grammar_points=chapter.grammar_points,
        cefr_level=chapter.cefr_level,
        proficiency_score=chapter_score,
        user_history=user_history if user_history else None,
        weak_points=weak_point_names if weak_point_names else None,
        topic=req.topic,
    )

    # Save the generated question to DB
    new_q = models.Question(
        japanese_text=q_data.japanese_text,
        expected_english_text=q_data.expected_english_text,
        grammar_point=q_data.grammar_point,
        difficulty=q_data.difficulty,
        chapter_id=chapter.id,
    )
    db.add(new_q)
    db.commit()
    db.refresh(new_q)

    return new_q


# ─── Answer Evaluation ───────────────────────────────────────────────────────

@app.post("/api/answers/evaluate", response_model=schemas.EvaluationResponse)
def evaluate_answer(
    submit: schemas.AnswerSubmit,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    question = db.query(models.Question).filter(
        models.Question.id == submit.question_id
    ).first()

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    # Evaluate using AI Service
    eval_result = ai_service.evaluate_answer(
        japanese=question.japanese_text,
        expected_english=question.expected_english_text,
        user_answer=submit.user_answer,
        grammar_point=question.grammar_point
    )

    # Create attempt record with chapter_id and grammar_point
    attempt = models.Attempt(
        user_id=user.id,
        question_id=question.id,
        user_answer=submit.user_answer,
        is_correct=eval_result.is_correct,
        ai_feedback=eval_result.feedback_text,
        score=eval_result.score,
        grammar_point=question.grammar_point,
        chapter_id=question.chapter_id,
    )
    db.add(attempt)

    # Update chapter-level proficiency
    if question.chapter_id:
        progress = db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user.id,
            models.UserChapterProgress.chapter_id == question.chapter_id
        ).first()

        if progress:
            progress.total_attempts += 1
            if eval_result.is_correct:
                progress.correct_attempts += 1

            # Exponential moving average for chapter score
            alpha = 0.3  # Weight for new score
            progress.proficiency_score = round(
                (1 - alpha) * progress.proficiency_score + alpha * eval_result.score, 1
            )
            progress.last_attempted_at = datetime.datetime.utcnow()

    db.commit()

    # Check mastery and unlock next chapter
    if question.chapter_id:
        check_chapter_mastery(user.id, question.chapter_id, db)

    # Update overall proficiency
    update_overall_proficiency(user, db)

    return eval_result


# ─── User Stats ───────────────────────────────────────────────────────────────

@app.get("/api/users/me/stats", response_model=schemas.UserStatsResponse)
def get_user_stats(
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    ensure_chapter_progress(user, db)

    # Overall stats
    all_attempts = db.query(models.Attempt).filter(
        models.Attempt.user_id == user.id
    ).all()
    total_attempts = len(all_attempts)
    correct_attempts = len([a for a in all_attempts if a.is_correct])
    overall_accuracy = round(
        (correct_attempts / total_attempts * 100) if total_attempts > 0 else 0, 1
    )

    # Chapter progress
    chapters = db.query(models.Chapter).order_by(models.Chapter.number).all()
    progress_map = {
        p.chapter_id: p for p in
        db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user.id
        ).all()
    }

    chapters_mastered = sum(
        1 for p in progress_map.values() if p.status == "mastered"
    )

    chapter_responses = []
    for ch in chapters:
        p = progress_map.get(ch.id)
        acc = 0.0
        if p and p.total_attempts > 0:
            acc = round(p.correct_attempts / p.total_attempts * 100, 1)
        chapter_responses.append(schemas.ChapterResponse(
            id=ch.id,
            number=ch.number,
            title=ch.title,
            description=ch.description,
            grammar_points=ch.grammar_points,
            cefr_level=ch.cefr_level,
            status=p.status if p else "locked",
            proficiency_score=round(p.proficiency_score, 1) if p else 0.0,
            total_attempts=p.total_attempts if p else 0,
            accuracy_rate=acc,
        ))

    # Determine overall level
    score = user.proficiency_score
    if score >= 70:
        overall_level = "Advanced"
    elif score >= 40:
        overall_level = "Intermediate"
    else:
        overall_level = "Beginner"

    # Global weak points (across all chapters)
    all_chapter_weak = []
    for ch in chapters:
        weak = get_weak_points(user.id, ch.id, db)
        all_chapter_weak.extend(weak)

    # Deduplicate and sort
    seen = set()
    unique_weak = []
    for w in sorted(all_chapter_weak, key=lambda x: x.accuracy):
        if w.grammar_point not in seen:
            seen.add(w.grammar_point)
            unique_weak.append(w)
    unique_weak = unique_weak[:5]  # Top 5 weakest

    return schemas.UserStatsResponse(
        overall_level=overall_level,
        overall_score=round(user.proficiency_score, 1),
        chapters_mastered=chapters_mastered,
        total_chapters=len(chapters),
        total_attempts=total_attempts,
        overall_accuracy=overall_accuracy,
        weak_points=unique_weak,
        chapter_progress=chapter_responses,
    )


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
