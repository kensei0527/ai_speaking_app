from __future__ import annotations

from fastapi import FastAPI, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi.middleware.cors import CORSMiddleware
from collections import defaultdict
import datetime
import json
import uvicorn
import os
import httpx


import models, schemas, database, ai_service, auth

models.Base.metadata.create_all(bind=database.engine)

app = FastAPI(title="AI English Composition App", version="3.0.0")

# Configure CORS for Next.js frontend
origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"https://(?:.*\.vercel\.app|.*-furuyakenseis-projects\.vercel\.app)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


from sqlalchemy import text

# ─── Startup: Seed chapters & Run migrations ─────────────────────────────────
@app.on_event("startup")
def startup_seed():
    db = database.SessionLocal()
    try:
        # Run lightweight migrations for existing `attempts` table
        try:
            db.execute(text("ALTER TABLE attempts ADD COLUMN lesson_id INTEGER;"))
            db.commit()
        except Exception:
            db.rollback()
            
        try:
            db.execute(text("ALTER TABLE attempts ADD COLUMN alternative_expressions TEXT;"))
            db.commit()
        except Exception:
            db.rollback()

        try:
            db.execute(text("ALTER TABLE attempts ADD COLUMN naturalness_tips TEXT;"))
            db.commit()
        except Exception:
            db.rollback()

        # Vercelでのタイムアウトを避けるため、自動シードは無効化（手動実行を推奨）
        # count = db.query(models.Chapter).count()
        # if count == 0:
        #     from seed_chapters import seed
        #     seed()
    finally:
        db.close()


# ─── Helper: ensure user has chapter progress rows ──────────────────────────
def ensure_chapter_progress(user: models.User, db: Session):
    """Create UserChapterProgress and UserScenarioProgress rows for any chapters/scenarios the user doesn't have yet."""
    chapters = db.query(models.Chapter).all()
    # Check chapter progress
    existing_chapter_ids = {
        p.chapter_id for p in
        db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user.id
        ).all()
    }
    # Check scenario progress
    existing_scenario_ids = {
        p.scenario_id for p in
        db.query(models.UserScenarioProgress).filter(
            models.UserScenarioProgress.user_id == user.id
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

        scenarios = db.query(models.Scenario).filter(models.Scenario.chapter_id == ch.id).all()
        for sc in scenarios:
            if sc.id not in existing_scenario_ids:
                # If chapter 1, its scenarios are available
                sc_status = "available" if ch.number == 1 else "locked"
                sc_progress = models.UserScenarioProgress(
                    user_id=user.id,
                    scenario_id=sc.id,
                    status=sc_status,
                )
                db.add(sc_progress)

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
def check_scenario_mastery(user_id: str, scenario_id: int, db: Session) -> bool:
    """Check if a scenario is mastered (score >= 80)."""
    progress = db.query(models.UserScenarioProgress).filter(
        models.UserScenarioProgress.user_id == user_id,
        models.UserScenarioProgress.scenario_id == scenario_id
    ).first()
    
    if not progress or progress.status == "mastered":
        return False
        
    if progress.proficiency_score >= 80 and progress.total_attempts >= 5:
        progress.status = "mastered"
        db.commit()
        return True
    return False


def check_chapter_mastery(user_id: str, chapter_id: int, db: Session) -> dict:
    """
    Check if a chapter should be marked as mastered and unlock next.
    Mastery condition: All scenarios in the chapter must be "mastered" (score >= 80)
    Returns dict with mastered and next_chapter_unlocked flags.
    """
    result = {"mastered": False, "next_chapter_unlocked": False}

    progress = db.query(models.UserChapterProgress).filter(
        models.UserChapterProgress.user_id == user_id,
        models.UserChapterProgress.chapter_id == chapter_id
    ).first()

    if not progress or progress.status == "mastered":
        return result

    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        return result

    scenarios = db.query(models.Scenario).filter(models.Scenario.chapter_id == chapter_id).all()
    if not scenarios:
        return result

    # Check if all scenarios are mastered
    all_mastered = True
    for sc in scenarios:
        sc_prog = db.query(models.UserScenarioProgress).filter(
            models.UserScenarioProgress.user_id == user_id,
            models.UserScenarioProgress.scenario_id == sc.id
        ).first()
        if not sc_prog or sc_prog.status != "mastered":
            all_mastered = False
            break

    if not all_mastered:
        return result

    # Mark as mastered
    progress.status = "mastered"
    result["mastered"] = True

    # Unlock next chapter and its scenarios
    next_chapter = db.query(models.Chapter).filter(
        models.Chapter.number == chapter.number + 1
    ).first()
    
    if next_chapter:
        next_progress = db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user_id,
            models.UserChapterProgress.chapter_id == next_chapter.id
        ).first()
        
        if next_progress and next_progress.status == "locked":
            next_progress.status = "available"
            result["next_chapter_unlocked"] = True
            
            # Unlock scenarios for next chapter
            next_scenarios = db.query(models.Scenario).filter(models.Scenario.chapter_id == next_chapter.id).all()
            for n_sc in next_scenarios:
                n_sc_prog = db.query(models.UserScenarioProgress).filter(
                    models.UserScenarioProgress.user_id == user_id,
                    models.UserScenarioProgress.scenario_id == n_sc.id
                ).first()
                if n_sc_prog and n_sc_prog.status == "locked":
                    n_sc_prog.status = "available"

    db.commit()
    return result


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


# ─── Helper: determine lesson size based on grammar points ───────────────────
def calc_lesson_size(grammar_points_str: str) -> int:
    """
    Case C: Determine lesson size based on number of grammar points.
    Each grammar point gets ~2 questions, minimum 4, maximum 10.
    """
    grammar_points = [gp.strip() for gp in grammar_points_str.split(",") if gp.strip()]
    size = len(grammar_points) * 2
    return max(4, min(size, 10))


# ═══════════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/")
def read_root():
    return {"message": "Welcome to the AI English Composition API v3.0"}


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

    # Get Scenarios
    scenarios_db = db.query(models.Scenario).filter(models.Scenario.chapter_id == chapter_id).order_by(models.Scenario.order_index).all()
    scenario_responses = []
    for sc in scenarios_db:
        sc_prog = db.query(models.UserScenarioProgress).filter(
            models.UserScenarioProgress.user_id == user.id,
            models.UserScenarioProgress.scenario_id == sc.id
        ).first()
        scenario_responses.append(schemas.ScenarioResponse(
            id=sc.id,
            chapter_id=sc.chapter_id,
            title=sc.title,
            description=sc.description,
            order_index=sc.order_index,
            status=sc_prog.status if sc_prog else "locked",
            proficiency_score=round(sc_prog.proficiency_score, 1) if sc_prog else 0.0,
            total_attempts=sc_prog.total_attempts if sc_prog else 0,
            correct_attempts=sc_prog.correct_attempts if sc_prog else 0,
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
        scenarios=scenario_responses,
    )



# ─── Lesson Endpoints ─────────────────────────────────────────────────────────


@app.post("/api/lessons/start", response_model=schemas.LessonResponse)
def start_lesson(
    req: schemas.LessonStartRequest,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    """
    Start a new lesson based on a predefined scenario.
    Pools predefined questions from the database instead of asking AI.
    """
    ensure_chapter_progress(user, db)

    scenario = db.query(models.Scenario).filter(models.Scenario.id == req.scenario_id).first()
    if not scenario:
        raise HTTPException(
            status_code=404, 
            detail=f"Scenario not found for ID: {req.scenario_id}"
        )
        
    chapter_id = scenario.chapter_id

    # Check access
    sc_progress = db.query(models.UserScenarioProgress).filter(
        models.UserScenarioProgress.user_id == user.id,
        models.UserScenarioProgress.scenario_id == scenario.id
    ).first()

    if sc_progress and sc_progress.status == "locked":
        raise HTTPException(status_code=403, detail="This scenario is still locked.")

    # Mark as in_progress if chapter was just available
    ch_progress = db.query(models.UserChapterProgress).filter(
        models.UserChapterProgress.user_id == user.id,
        models.UserChapterProgress.chapter_id == chapter_id
    ).first()
    if ch_progress and ch_progress.status == "available":
        ch_progress.status = "in_progress"

    # Get predefined questions from DB (shuffle them)
    questions_query = db.query(models.Question).filter(models.Question.scenario_id == scenario.id).all()
    if not questions_query:
        raise HTTPException(
            status_code=404, 
            detail=f"No questions found for scenario ID: {scenario.id} (Title: {scenario.title})"
        )
        
    import random
    random.shuffle(questions_query)
    
    # Pick top 10 or max available
    lesson_size = min(10, len(questions_query))
    selected_questions = questions_query[:lesson_size]

    # Create Lesson record
    lesson = models.Lesson(
        user_id=user.id,
        chapter_id=chapter_id,
        scenario_id=scenario.id,
        total_questions=lesson_size,
    )
    db.add(lesson)
    db.flush()

    # Create LessonQuestion junction records
    for idx, q in enumerate(selected_questions):
        lq = models.LessonQuestion(
            lesson_id=lesson.id,
            question_id=q.id,
            order_index=idx,
        )
        db.add(lq)

    db.commit()
    db.refresh(lesson)

    # Build response
    question_infos = []
    for lq in lesson.questions:
        q = db.query(models.Question).filter(models.Question.id == lq.question_id).first()
        question_infos.append(schemas.LessonQuestionInfo(
            id=q.id,
            japanese_text=q.japanese_text,
            expected_english_text=q.expected_english_text,
            grammar_point=q.grammar_point,
            difficulty=q.difficulty,
            order_index=lq.order_index,
        ))

    return schemas.LessonResponse(
        lesson_id=lesson.id,
        chapter_id=chapter_id,
        scenario_id=lesson.scenario_id,
        is_review=lesson.is_review,
        questions=question_infos,
        total_questions=lesson.total_questions,
    )


@app.post("/api/lessons/{lesson_id}/review", response_model=schemas.LessonResponse)
def review_lesson(
    lesson_id: int,
    req: schemas.LessonReviewRequest,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    """
    Creates a new review lesson from a previous lesson.
    mode='weak': Only questions with score < 60
    mode='all': All questions from the previous lesson
    """
    old_lesson = db.query(models.Lesson).filter(
        models.Lesson.id == lesson_id,
        models.Lesson.user_id == user.id
    ).first()
    
    if not old_lesson:
        raise HTTPException(status_code=404, detail="Previous lesson not found")
        
    old_lqs = db.query(models.LessonQuestion).filter(models.LessonQuestion.lesson_id == old_lesson.id).all()
    q_ids_to_review = []
    
    if req.mode == "weak":
        # Find which questions the user got poorly on in the previous lesson
        attempts = db.query(models.Attempt).filter(models.Attempt.lesson_id == old_lesson.id).all()
        weak_q_ids = [a.question_id for a in attempts if a.score < 60]
        q_ids_to_review = weak_q_ids
    else:
        q_ids_to_review = [lq.question_id for lq in old_lqs]
        
    if not q_ids_to_review:
        raise HTTPException(status_code=400, detail="No questions to review in this mode")
        
    # Create new review lesson
    new_lesson = models.Lesson(
        user_id=user.id,
        chapter_id=old_lesson.chapter_id,
        scenario_id=old_lesson.scenario_id,
        is_review=True,
        total_questions=len(q_ids_to_review)
    )
    db.add(new_lesson)
    db.flush()
    
    import random
    random.shuffle(q_ids_to_review)
    
    for idx, q_id in enumerate(q_ids_to_review):
        lq = models.LessonQuestion(
            lesson_id=new_lesson.id,
            question_id=q_id,
            order_index=idx
        )
        db.add(lq)
        
    db.commit()
    db.refresh(new_lesson)
    
    # Build response
    question_infos = []
    for lq in new_lesson.questions:
        q = db.query(models.Question).filter(models.Question.id == lq.question_id).first()
        question_infos.append(schemas.LessonQuestionInfo(
            id=q.id,
            japanese_text=q.japanese_text,
            expected_english_text=q.expected_english_text,
            grammar_point=q.grammar_point,
            difficulty=q.difficulty,
            order_index=lq.order_index,
        ))

    return schemas.LessonResponse(
        lesson_id=new_lesson.id,
        chapter_id=new_lesson.chapter_id,
        scenario_id=new_lesson.scenario_id,
        is_review=new_lesson.is_review,
        questions=question_infos,
        total_questions=new_lesson.total_questions,
    )


@app.post("/api/lessons/{lesson_id}/complete", response_model=schemas.LessonCompleteResponse)
def complete_lesson(
    lesson_id: int,
    req: schemas.LessonCompleteRequest,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    """
    Submit all answers for a lesson at once.
    Evaluates each answer, updates progress, checks for mastery.
    """
    lesson = db.query(models.Lesson).filter(
        models.Lesson.id == lesson_id,
        models.Lesson.user_id == user.id,
    ).first()
    if not lesson:
        raise HTTPException(status_code=404, detail="Lesson not found")
    if lesson.status == "completed":
        raise HTTPException(status_code=400, detail="Lesson already completed")

    # Build a map of question_id -> LessonQuestion for order_index lookup
    lq_map = {lq.question_id: lq for lq in lesson.questions}

    results = []
    correct_count = 0
    total_score = 0.0

    for answer_item in req.answers:
        question = db.query(models.Question).filter(
            models.Question.id == answer_item.question_id
        ).first()
        if not question:
            continue

        lq = lq_map.get(answer_item.question_id)
        order_index = lq.order_index if lq else 0

        # Evaluate with AI
        eval_result = ai_service.evaluate_answer(
            japanese=question.japanese_text,
            expected_english=question.expected_english_text,
            user_answer=answer_item.user_answer,
            grammar_point=question.grammar_point,
        )

        # Save attempt
        attempt = models.Attempt(
            user_id=user.id,
            question_id=question.id,
            lesson_id=lesson.id,
            user_answer=answer_item.user_answer,
            is_correct=eval_result.is_correct,
            ai_feedback=eval_result.feedback_text,
            alternative_expressions=json.dumps(eval_result.alternative_expressions, ensure_ascii=False),
            naturalness_tips=json.dumps(eval_result.naturalness_tips, ensure_ascii=False),
            score=eval_result.score,
            grammar_point=question.grammar_point,
            chapter_id=question.chapter_id,
        )
        db.add(attempt)

        # Update scenario progress
        if lesson.scenario_id:
            sc_progress = db.query(models.UserScenarioProgress).filter(
                models.UserScenarioProgress.user_id == user.id,
                models.UserScenarioProgress.scenario_id == lesson.scenario_id
            ).first()
            if sc_progress:
                sc_progress.total_attempts += 1
                if eval_result.is_correct:
                    sc_progress.correct_attempts += 1
                
                # EMA for scenario score
                alpha = 0.3
                sc_progress.proficiency_score = round(
                    (1 - alpha) * sc_progress.proficiency_score + alpha * eval_result.score, 1
                )

        # Update chapter progress
        if question.chapter_id:
            progress = db.query(models.UserChapterProgress).filter(
                models.UserChapterProgress.user_id == user.id,
                models.UserChapterProgress.chapter_id == question.chapter_id
            ).first()
            if progress:
                progress.total_attempts += 1
                if eval_result.is_correct:
                    progress.correct_attempts += 1

                # Weighted updates for chapter score
                alpha = 0.1 # less weight for overall chapter score per attempt
                progress.proficiency_score = round(
                    (1 - alpha) * progress.proficiency_score + alpha * eval_result.score, 1
                )
                progress.last_attempted_at = datetime.datetime.utcnow()

        if eval_result.is_correct:
            correct_count += 1
        total_score += eval_result.score

        results.append(schemas.LessonAnswerResult(
            question_id=question.id,
            order_index=order_index,
            japanese_text=question.japanese_text,
            user_answer=answer_item.user_answer,
            is_correct=eval_result.is_correct,
            score=eval_result.score,
            evaluation_level=eval_result.evaluation_level,
            feedback_text=eval_result.feedback_text,
            expected_english=eval_result.expected_english,
            grammar_point=eval_result.grammar_point,
            alternative_expressions=eval_result.alternative_expressions,
            naturalness_tips=eval_result.naturalness_tips,
        ))

    db.commit()

    # Check mastery
    if lesson.scenario_id:
        check_scenario_mastery(user.id, lesson.scenario_id, db)
    mastery_result = check_chapter_mastery(user.id, lesson.chapter_id, db)

    # Update overall proficiency
    update_overall_proficiency(user, db)

    # Mark lesson as completed
    lesson.status = "completed"
    lesson.completed_at = datetime.datetime.utcnow()
    db.commit()

    answered_count = len(results)
    accuracy = round((correct_count / answered_count * 100) if answered_count > 0 else 0, 1)
    avg_score = round(total_score / answered_count if answered_count > 0 else 0, 1)

    # Sort results by order_index
    results.sort(key=lambda r: r.order_index)

    return schemas.LessonCompleteResponse(
        lesson_id=lesson.id,
        chapter_id=lesson.chapter_id,
        scenario_id=lesson.scenario_id,
        total_questions=answered_count,
        correct_count=correct_count,
        accuracy_rate=accuracy,
        average_score=avg_score,
        chapter_mastered=mastery_result["mastered"],
        next_chapter_unlocked=mastery_result["next_chapter_unlocked"],
        results=results,
    )


# ─── Legacy: Single Question Generation (kept for backward compat) ────────────

@app.post("/api/questions/generate", response_model=schemas.QuestionResponse)
def generate_question(
    req: schemas.GenerateQuestionRequest,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    """Generate a single question (legacy endpoint)."""
    ensure_chapter_progress(user, db)

    chapter = db.query(models.Chapter).filter(models.Chapter.id == req.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    progress = db.query(models.UserChapterProgress).filter(
        models.UserChapterProgress.user_id == user.id,
        models.UserChapterProgress.chapter_id == req.chapter_id
    ).first()

    if progress and progress.status == "locked":
        raise HTTPException(status_code=403, detail="This chapter is still locked.")

    if progress and progress.status == "available":
        progress.status = "in_progress"
        db.commit()

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

    weak_point_infos = get_weak_points(user.id, req.chapter_id, db)
    weak_point_names = [wp.grammar_point for wp in weak_point_infos]
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


# ─── Legacy: Single Answer Evaluation (kept for backward compat) ──────────────

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

    eval_result = ai_service.evaluate_answer(
        japanese=question.japanese_text,
        expected_english=question.expected_english_text,
        user_answer=submit.user_answer,
        grammar_point=question.grammar_point
    )

    attempt = models.Attempt(
        user_id=user.id,
        question_id=question.id,
        lesson_id=submit.lesson_id,
        user_answer=submit.user_answer,
        is_correct=eval_result.is_correct,
        ai_feedback=eval_result.feedback_text,
        alternative_expressions=json.dumps(eval_result.alternative_expressions, ensure_ascii=False),
        naturalness_tips=json.dumps(eval_result.naturalness_tips, ensure_ascii=False),
        score=eval_result.score,
        grammar_point=question.grammar_point,
        chapter_id=question.chapter_id,
    )
    db.add(attempt)

    if question.chapter_id:
        progress = db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user.id,
            models.UserChapterProgress.chapter_id == question.chapter_id
        ).first()

        if progress:
            progress.total_attempts += 1
            if eval_result.is_correct:
                progress.correct_attempts += 1

            alpha = 0.3
            progress.proficiency_score = round(
                (1 - alpha) * progress.proficiency_score + alpha * eval_result.score, 1
            )
            progress.last_attempted_at = datetime.datetime.utcnow()

    db.commit()

    if question.chapter_id:
        check_chapter_mastery(user.id, question.chapter_id, db)

    update_overall_proficiency(user, db)
    return eval_result


# ─── User Stats ───────────────────────────────────────────────────────────────

@app.get("/api/users/me/stats", response_model=schemas.UserStatsResponse)
def get_user_stats(
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    ensure_chapter_progress(user, db)

    all_attempts = db.query(models.Attempt).filter(
        models.Attempt.user_id == user.id
    ).all()
    total_attempts = len(all_attempts)
    correct_attempts = len([a for a in all_attempts if a.is_correct])
    overall_accuracy = round(
        (correct_attempts / total_attempts * 100) if total_attempts > 0 else 0, 1
    )

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

    # Improved level determination: based on chapters mastered AND score
    # Prevents "Advanced" from appearing after just 1 chapter
    mastered_count = chapters_mastered
    total_chapters = len(chapters)
    avg_score = user.proficiency_score

    if mastered_count >= 7 and avg_score >= 70:
        overall_level = "Advanced"
    elif mastered_count >= 3 and avg_score >= 50:
        overall_level = "Intermediate"
    else:
        overall_level = "Beginner"

    # Global weak points (across all chapters)
    all_chapter_weak = []
    for ch in chapters:
        weak = get_weak_points(user.id, ch.id, db)
        all_chapter_weak.extend(weak)

    seen = set()
    unique_weak = []
    for w in sorted(all_chapter_weak, key=lambda x: x.accuracy):
        if w.grammar_point not in seen:
            seen.add(w.grammar_point)
            unique_weak.append(w)
    unique_weak = unique_weak[:5]

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


# ─── Skill Report ────────────────────────────────────────────────────────────

@app.get("/api/users/me/report", response_model=schemas.SkillReport)
def get_skill_report(
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user)
):
    """
    Returns a detailed skill report analyzing grammar point performance
    across all chapters. Used in the profile page.
    """
    ensure_chapter_progress(user, db)

    chapters = db.query(models.Chapter).order_by(models.Chapter.number).all()
    progress_map = {
        p.chapter_id: p for p in
        db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user.id
        ).all()
    }

    # Build per-grammar-point stats across all chapters
    attempts = db.query(models.Attempt).filter(
        models.Attempt.user_id == user.id,
        models.Attempt.grammar_point.isnot(None)
    ).all()

    gp_to_chapter: dict[str, str] = {}
    for ch in chapters:
        for gp in [g.strip() for g in ch.grammar_points.split(",")]:
            gp_to_chapter[gp] = ch.title

    gp_stats: dict[str, dict] = defaultdict(lambda: {"total": 0, "correct": 0})
    for a in attempts:
        if a.grammar_point:
            gp_stats[a.grammar_point]["total"] += 1
            if a.is_correct:
                gp_stats[a.grammar_point]["correct"] += 1

    # Build skill list
    all_skills = []
    for gp, stats in gp_stats.items():
        if stats["total"] < 2:
            continue  # Skip grammar points with too few data points
        accuracy = round(stats["correct"] / stats["total"] * 100, 1)
        all_skills.append(schemas.GrammarSkill(
            grammar_point=gp,
            attempts=stats["total"],
            accuracy=accuracy,
            chapter_title=gp_to_chapter.get(gp, "不明"),
        ))

    # Sort: strong = high accuracy, weak = low accuracy
    all_skills.sort(key=lambda s: s.accuracy, reverse=True)
    strong_skills = all_skills[:3]
    weak_skills = list(reversed(all_skills[-3:])) if len(all_skills) >= 3 else list(reversed(all_skills))

    # Chapter scores for radar chart
    chapter_scores = []
    for ch in chapters:
        p = progress_map.get(ch.id)
        chapter_scores.append({
            "chapter_title": ch.title,
            "chapter_number": ch.number,
            "score": round(p.proficiency_score, 1) if p else 0.0,
            "status": p.status if p else "locked",
        })

    # AI-generated summary (brief analysis of the user's skill profile)
    if all_skills:
        strong_list = ", ".join([s.grammar_point for s in strong_skills]) if strong_skills else "なし"
        weak_list = ", ".join([s.grammar_point for s in weak_skills]) if weak_skills else "なし"
        total_attempts_count = sum(s.attempts for s in all_skills)
        overall_accuracy = round(
            sum(s.accuracy * s.attempts for s in all_skills) / total_attempts_count, 1
        ) if total_attempts_count > 0 else 0

        ai_summary = (
            f"総合正答率 {overall_accuracy}%（{total_attempts_count}問回答済み）。"
            f"得意な文法: {strong_list}。"
            f"苦手な文法: {weak_list}。"
        )
    else:
        ai_summary = "まだ十分なデータがありません。レッスンを始めてスキルレポートを育てましょう！"

    return schemas.SkillReport(
        strong_skills=strong_skills,
        weak_skills=weak_skills,
        chapter_scores=chapter_scores,
        ai_summary=ai_summary,
    )


# ─── Live Conversation (Add-on Feature) ──────────────────────────────────────

from fastapi import WebSocket, WebSocketDisconnect
import conversation_service


@app.get("/api/chapters/{chapter_id}/phrases")
def get_chapter_phrases(
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user),
):
    """
    ユーザーがその章で実際に学んだフレーズのリストを返す。
    会話モードのシステムプロンプト構築に使用。
    """
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # その章のユーザー解答から正解したフレーズを取得（最大20件）
    correct_attempts = (
        db.query(models.Attempt)
        .filter(
            models.Attempt.user_id == user.id,
            models.Attempt.chapter_id == chapter_id,
            models.Attempt.is_correct == True,
        )
        .order_by(models.Attempt.created_at.desc())
        .limit(30)
        .all()
    )

    # question の expected_english_text を取得（重複除去）
    seen = set()
    phrases = []
    for a in correct_attempts:
        q = db.query(models.Question).filter(models.Question.id == a.question_id).first()
        if q and q.expected_english_text and q.expected_english_text not in seen:
            seen.add(q.expected_english_text)
            phrases.append(q.expected_english_text)
            if len(phrases) >= 20:
                break

    # 正解フレーズが少ない場合は全問題フレーズで補完
    if len(phrases) < 5:
        questions = (
            db.query(models.Question)
            .filter(models.Question.chapter_id == chapter_id)
            .limit(20)
            .all()
        )
        for q in questions:
            if q.expected_english_text and q.expected_english_text not in seen:
                seen.add(q.expected_english_text)
                phrases.append(q.expected_english_text)

    return {
        "chapter_id": chapter_id,
        "chapter_title": chapter.title,
        "phrases": phrases[:20],
    }


@app.websocket("/ws/live-conversation/{chapter_id}")
async def live_conversation(
    websocket: WebSocket,
    chapter_id: int,
    db: Session = Depends(database.get_db),
):
    """
    Gemini Live API へのリアルタイム音声会話プロキシ。
    既存の問題生成・採点フローとは完全に独立した追加機能。

    認証: 最初のメッセージで {"type": "auth", "token": "<supabase_access_token>"} を受け取り、
          auth.py の verify_token で検証する。
    """
    await websocket.accept()

    # ─ 認証フェーズ ─────────────────────────────────────────────────────────
    try:
        raw_auth = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
        auth_msg = json.loads(raw_auth)
        if auth_msg.get("type") != "auth":
            await websocket.send_json({"type": "error", "message": "First message must be auth."})
            await websocket.close()
            return

        token = auth_msg.get("token", "")
        user = auth.verify_token_raw(token, db)
        if not user:
            await websocket.send_json({"type": "error", "message": "Unauthorized."})
            await websocket.close()
            return

    except (asyncio.TimeoutError, Exception) as e:
        await websocket.send_json({"type": "error", "message": f"Auth failed: {e}"})
        await websocket.close()
        return

    # ─ フレーズ取得 ──────────────────────────────────────────────────────────
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        await websocket.send_json({"type": "error", "message": "Chapter not found."})
        await websocket.close()
        return

    correct_attempts = (
        db.query(models.Attempt)
        .filter(
            models.Attempt.user_id == user.id,
            models.Attempt.chapter_id == chapter_id,
            models.Attempt.is_correct == True,
        )
        .order_by(models.Attempt.created_at.desc())
        .limit(30)
        .all()
    )
    seen: set[str] = set()
    phrases: list[str] = []
    for a in correct_attempts:
        q = db.query(models.Question).filter(models.Question.id == a.question_id).first()
        if q and q.expected_english_text and q.expected_english_text not in seen:
            seen.add(q.expected_english_text)
            phrases.append(q.expected_english_text)
            if len(phrases) >= 20:
                break

    if len(phrases) < 5:
        questions = (
            db.query(models.Question)
            .filter(models.Question.chapter_id == chapter_id)
            .limit(20)
            .all()
        )
        for q in questions:
            if q.expected_english_text and q.expected_english_text not in seen:
                seen.add(q.expected_english_text)
                phrases.append(q.expected_english_text)

    # ─ Gemini Live API へ中継 ────────────────────────────────────────────────
    await conversation_service.proxy_live_session(
        client_ws=websocket,
        chapter_title=chapter.title,
        phrases=phrases[:20],
    )


@app.post("/api/chapters/{chapter_id}/live-token")
async def issue_live_token(
    chapter_id: int,
    db: Session = Depends(database.get_db),
    user: models.User = Depends(auth.get_current_user),
):
    """
    Gemini Live API 用の Ephemeral Token を発行して返す。

    ・実際の GEMINI_API_KEY はこのサーバー内にとどまる（フロントに渡さない）
    ・トークンには live_connect_constraints でモデル設定とシステムプロンプトを埋め込む
    ・new_session_expire_time=1分 / expire_time=30分 で発行
    ・フロントはこのトークンを access_token として v1alpha WSS エンドポイントに使う
    """
    # ─ 章とフレーズ取得 ──────────────────────────────────────────────────────
    chapter = db.query(models.Chapter).filter(models.Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    correct_attempts = (
        db.query(models.Attempt)
        .filter(
            models.Attempt.user_id == user.id,
            models.Attempt.chapter_id == chapter_id,
            models.Attempt.is_correct == True,
        )
        .order_by(models.Attempt.created_at.desc())
        .limit(30)
        .all()
    )
    seen: set[str] = set()
    phrases: list[str] = []
    for a in correct_attempts:
        q = db.query(models.Question).filter(models.Question.id == a.question_id).first()
        if q and q.expected_english_text and q.expected_english_text not in seen:
            seen.add(q.expected_english_text)
            phrases.append(q.expected_english_text)
            if len(phrases) >= 20:
                break
    if len(phrases) < 5:
        questions = (
            db.query(models.Question)
            .filter(models.Question.chapter_id == chapter_id)
            .limit(20)
            .all()
        )
        for q in questions:
            if q.expected_english_text and q.expected_english_text not in seen:
                seen.add(q.expected_english_text)
                phrases.append(q.expected_english_text)

    system_prompt = conversation_service.build_system_prompt(chapter.title, phrases[:20])


    # ─ google-genai SDK で ephemeral token 発行（公式サンプル準拠）─────────────
    try:
        from google import genai as google_genai

        gemini_api_key = os.getenv("GEMINI_API_KEY", "")
        if not gemini_api_key:
            raise HTTPException(status_code=500, detail="GEMINI_API_KEY not configured")

        genai_client = google_genai.Client(
            api_key=gemini_api_key,
            http_options={"api_version": "v1alpha"},
        )

        now = datetime.datetime.now(tz=datetime.timezone.utc)
        expire_time = now + datetime.timedelta(minutes=30)

        token = genai_client.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": expire_time.isoformat(),
                "new_session_expire_time": (now + datetime.timedelta(minutes=2)).isoformat(),
                "http_options": {"api_version": "v1alpha"},
            }
        )
        ephemeral_token = token.name
        if not ephemeral_token:
            raise HTTPException(status_code=502, detail="Empty token from Gemini")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Token issuance failed: {str(e)}")

    # ユーザーの習熟度レベルを判定
    # get_user_stats と同様のロジックを使用
    chapters_mastered = db.query(models.UserChapterProgress).filter(
        models.UserChapterProgress.user_id == user.id,
        models.UserChapterProgress.status == "mastered"
    ).count()
    
    avg_proficiency = user.proficiency_score
    if chapters_mastered >= 7 and avg_proficiency >= 70:
        user_level = "Advanced"
    elif chapters_mastered >= 3 and avg_proficiency >= 50:
        user_level = "Intermediate"
    else:
        user_level = "Beginner"

    # フロントはこのトークンで v1alpha WSS に直接接続する
    # システムプロンプトはフロント側の setup メッセージで送る（APIキー非公開は維持）
    return {
        "token": ephemeral_token,
        "chapter_title": chapter.title,
        "phrases": phrases[:20],
        "model": conversation_service.LIVE_API_MODEL,
        "user_level": user_level,
        "cefr_level": chapter.cefr_level,
        "ws_url": (
            "wss://generativelanguage.googleapis.com/ws/"
            "google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
            f"?access_token={ephemeral_token}"
        ),
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

