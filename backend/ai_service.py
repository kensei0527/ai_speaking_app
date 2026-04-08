from __future__ import annotations

import os
import json
import random
from typing import Optional, List
import google.generativeai as genai
from dotenv import load_dotenv
from schemas import EvaluationResponse, QuestionBase

load_dotenv()

# Configure Google Gemini AI
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)
else:
    print("WARNING: GEMINI_API_KEY is not set.")

# Variety pools for diverse question generation
SENTENCE_FORMS = ["肯定文", "否定文", "疑問文", "命令文"]
CONTEXTS = ["家族・友人", "職場・学校", "旅行・観光", "日常の買い物", "趣味・スポーツ", "健康・医療", "食事・料理", "ニュース・時事"]


def get_model():
    return genai.GenerativeModel(
        'gemini-2.5-flash',
        generation_config={"response_mime_type": "application/json"}
    )


def generate_question(
    chapter_title: str,
    chapter_grammar_points: str,
    cefr_level: str,
    proficiency_score: float,
    user_history: list[dict] | None = None,
    weak_points: list[str] | None = None,
    topic: str | None = None,
    recent_grammar_points: list[str] | None = None,
    sentence_form: str | None = None,
    context: str | None = None,
) -> QuestionBase:
    """
    Generates a new Japanese-English problem based on:
    - Chapter theme and grammar points
    - User's per-chapter proficiency score
    - Recent attempt history (last 10)
    - Identified weak grammar points
    - Forced variety parameters (sentence_form, context)
    """
    model = get_model()

    # Build the history context
    history_context = ""
    if user_history:
        history_lines = []
        for h in user_history[-10:]:  # Last 10 attempts
            status = "✅ 正解" if h.get("is_correct") else "❌ 不正解"
            history_lines.append(
                f"- 文法: {h.get('grammar_point', '不明')} | {status} | "
                f"ユーザー回答: \"{h.get('user_answer', '')}\""
            )
        history_context = (
            "\n\n## ユーザーの直近の解答履歴:\n"
            + "\n".join(history_lines)
        )

    # Build weak points context
    weak_context = ""
    if weak_points:
        weak_context = (
            f"\n\n## ユーザーが苦手な文法ポイント:\n"
            f"以下の文法を重点的に出題してください: {', '.join(weak_points)}"
        )

    # Avoid repeating recent grammar points
    avoid_context = ""
    if recent_grammar_points:
        avoid_context = (
            f"\n\n## 直前に出題した文法ポイント（重複は避けてください）:\n"
            f"{', '.join(recent_grammar_points)}"
        )

    # Topic override
    if topic:
        variety_instruction = f"特に以下のトピックにフォーカスしてください: {topic}"
    else:
        sf = sentence_form or random.choice(SENTENCE_FORMS)
        ctx = context or random.choice(CONTEXTS)
        variety_instruction = (
            f"以下の条件で問題を作成してください:\n"
            f"- 文の形式: {sf}\n"
            f"- 場面・文脈: {ctx}\n"
            f"これにより問題のバリエーションを確保してください。"
        )

    prompt = f"""
You are an expert English teacher creating an "Instant English Composition" (瞬間英作文) exercise.

## 章の情報:
- テーマ: {chapter_title}
- 対象文法: {chapter_grammar_points}
- CEFRレベル: {cefr_level}
- ユーザーの現在の習熟度スコア: {proficiency_score:.1f} / 100
{history_context}
{weak_context}
{avoid_context}

## 指示:
{variety_instruction}

- 対象文法の範囲内で問題を作成してください
- ユーザーの習熟度に合わせて難易度を調整してください
  - スコア0-30: 基本的で短い文
  - スコア30-60: やや複雑な文
  - スコア60-100: 応用的な表現を含む文
- 同じパターンの繰り返しを避け、バリエーションのある問題を出してください
- 苦手なポイントがある場合はそこを重点的にカバーしてください

Output ONLY a JSON object with these keys:
"japanese_text": "The sentence in Japanese",
"expected_english_text": "The natural English translation",
"grammar_point": "The main grammar point used (from the chapter's grammar list)",
"difficulty": <integer from 1 to 5 based on complexity>
"""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]

        data = json.loads(text.strip())
        return QuestionBase(
            japanese_text=data.get("japanese_text", ""),
            expected_english_text=data.get("expected_english_text", ""),
            grammar_point=data.get("grammar_point", ""),
            difficulty=data.get("difficulty", 1)
        )
    except Exception as e:
        print(f"Error generating question: {e}")
        return QuestionBase(
            japanese_text="これはペンです。",
            expected_english_text="This is a pen.",
            grammar_point="be動詞",
            difficulty=1
        )


def generate_questions_batch(
    chapter_title: str,
    chapter_grammar_points: str,
    cefr_level: str,
    proficiency_score: float,
    count: int,
    user_history: list[dict] | None = None,
    weak_points: list[str] | None = None,
) -> list[QuestionBase]:
    """
    Generates `count` diverse questions in a single AI call.
    Uses varied sentence forms and contexts to ensure variety.
    """
    model = get_model()

    # Build history context
    history_context = ""
    if user_history:
        history_lines = []
        for h in user_history[-10:]:
            status = "✅ 正解" if h.get("is_correct") else "❌ 不正解"
            history_lines.append(
                f"- 文法: {h.get('grammar_point', '不明')} | {status} | "
                f"回答: \"{h.get('user_answer', '')}\""
            )
        history_context = (
            "\n\n## ユーザーの直近の解答履歴:\n"
            + "\n".join(history_lines)
        )

    weak_context = ""
    if weak_points:
        weak_context = (
            f"\n\n## ユーザーが苦手な文法ポイント:\n"
            f"以下の文法を重点的に出題してください: {', '.join(weak_points)}"
        )

    # Select varied forms & contexts
    forms = random.sample(SENTENCE_FORMS * 3, min(count, len(SENTENCE_FORMS) * 3))[:count]
    contexts = random.sample(CONTEXTS * 2, min(count, len(CONTEXTS) * 2))[:count]
    grammar_list = [gp.strip() for gp in chapter_grammar_points.split(",")]

    variety_specs = []
    for i in range(count):
        gp = grammar_list[i % len(grammar_list)]
        variety_specs.append(
            f"  問題{i+1}: 文の形式={forms[i]}, 場面={contexts[i]}, 優先文法={gp}"
        )

    prompt = f"""
You are an expert English teacher creating "Instant English Composition" (瞬間英作文) exercises.

## 章の情報:
- テーマ: {chapter_title}
- 対象文法: {chapter_grammar_points}
- CEFRレベル: {cefr_level}
- ユーザーの現在の習熟度スコア: {proficiency_score:.1f} / 100
{history_context}
{weak_context}

## 指示:
以下の仕様で {count} 問の問題を作成してください。それぞれ異なる文脈・文の形式・文法ポイントを使い、バリエーションを持たせてください。

### 各問題の仕様:
{chr(10).join(variety_specs)}

### 難易度ガイド:
- スコア0-30: 基本的で短い文
- スコア30-60: やや複雑な文
- スコア60-100: 応用的な表現を含む文

Output ONLY a JSON array of {count} objects. Each object must have:
"japanese_text": "The sentence in Japanese",
"expected_english_text": "The natural English translation",
"grammar_point": "The main grammar point used",
"difficulty": <integer 1-5>

Output ONLY the JSON array, no other text.
"""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]

        data_list = json.loads(text.strip())
        if not isinstance(data_list, list):
            data_list = [data_list]

        questions = []
        for data in data_list[:count]:
            questions.append(QuestionBase(
                japanese_text=data.get("japanese_text", ""),
                expected_english_text=data.get("expected_english_text", ""),
                grammar_point=data.get("grammar_point", ""),
                difficulty=data.get("difficulty", 1)
            ))
        return questions

    except Exception as e:
        print(f"Error generating question batch: {e}")
        # Return fallback questions
        return [
            QuestionBase(
                japanese_text="これはペンです。",
                expected_english_text="This is a pen.",
                grammar_point=grammar_list[0] if grammar_list else "be動詞",
                difficulty=1
            )
            for _ in range(count)
        ]


def evaluate_answer(
    japanese: str,
    expected_english: str,
    user_answer: str,
    grammar_point: str
) -> EvaluationResponse:
    """
    Evaluates the user's answer against the expected answer and Japanese text.
    Returns rich feedback including alternative expressions and naturalness tips.
    """
    model = get_model()

    prompt = f"""
You are an expert English teacher evaluating a student's answer in an "Instant English Composition" (瞬間英作文) exercise.
This is a speaking-focused exercise, so naturalness and whether the MEANING is conveyed are much more important than strict grammatical perfection.

Task:
Original Japanese: "{japanese}"
Target Grammar Point: "{grammar_point}"
Model/Expected English Answer: "{expected_english}"

Student's Answer: "{user_answer}"

Analyze the student's answer focusing on:
1. Meaning conveyance (Does a native speaker understand what they are trying to say?)
2. Naturalness for spoken English.
3. Proper use of the target grammar point (Secondary priority).

Assign a score (0-100) and an `evaluation_level` based on these criteria:
- Score 90-100 (Perfect): Grammatically correct and highly natural.
- Score 70-89 (Great): There are minor grammatical errors, but the meaning is perfectly clear to a native speaker. This is a very good attempt for speaking!
- Score 50-69 (Good): The meaning is somewhat conveyed, but it's unnatural or has noticeable grammar mistakes.
- Score 0-49 (Try Again): The meaning is lost, highly confusing, or completely incorrect.

Also output `is_correct`. Set `is_correct: true` if the score is 70 or above (meaning is perfectly clear).

Output ONLY a JSON object with the following keys:
"is_correct": <boolean: true if score >= 70, false otherwise>,
"score": <number between 0 and 100>,
"evaluation_level": <string: exactly one of "Perfect", "Great", "Good", "Try Again">,
"feedback_text": "A brief, encouraging explanation in Japanese. Explain the evaluation level. If it's 'Great', praise them that the meaning was conveyed well. Keep it concise.",
"alternative_expressions": ["2-3 other natural English ways to say the same thing. Focus on expressions useful for speaking."],
"naturalness_tips": ["1-2 practical tips to make the expression sound more natural in conversation. Only include if genuinely useful, otherwise leave empty array."]
"""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]

        data = json.loads(text.strip())
        return EvaluationResponse(
            is_correct=data.get("is_correct", False),
            score=data.get("score", 0.0),
            evaluation_level=data.get("evaluation_level", "Try Again"),
            feedback_text=data.get("feedback_text", "Could not analyze the answer."),
            expected_english=expected_english,
            grammar_point=grammar_point,
            alternative_expressions=data.get("alternative_expressions", []),
            naturalness_tips=data.get("naturalness_tips", []),
        )
    except Exception as e:
        print(f"Error evaluating answer: {e}")
        return EvaluationResponse(
            is_correct=False,
            score=0,
            evaluation_level="Try Again",
            feedback_text="サーバーエラーにより添削できませんでした。(Server Error)",
            expected_english=expected_english,
            grammar_point=grammar_point,
            alternative_expressions=[],
            naturalness_tips=[],
        )


def evaluate_conversation_history(transcript, chapter_title: str, phrases: List[str]):
    """
    Evaluates the full transcript of a live conversation session.
    Returns: { overall_score, summary, strengths, improvement_areas, alternative_phrases }
    """
    model = get_model()
    
    # Format the transcript for the prompt
    transcript_text = ""
    for entry in transcript:
        role = "AI Coach" if entry.role == "model" else "Student"
        transcript_text += f"{role}: {entry.text}\n"

    phrase_str = "\n".join(f"- {p}" for p in phrases) if phrases else "(なし)"

    prompt = f"""
You are an expert English conversation evaluator.
Review the following transcript of a live English conversation practice session.
The student played a roleplay interacting with an AI coach based on Chapter: "{chapter_title}".

Target Phrases for this chapter:
{phrase_str}

Conversation Transcript:
{transcript_text}

Provide a comprehensive, encouraging evaluation IN JAPANESE for the student.
Output ONLY a valid JSON object matching this structure exactly:
{{
  "overall_score": <int: 0 to 100 based on fluency, grammar, and engagement>,
  "summary": "<string: A 2-3 sentence overall encouraging feedback in Japanese>",
  "strengths": [
    "<string: Specific praise (e.g., 'You used the phrase X naturally', 'Good pronunciation implication') in Japanese>"
  ],
  "improvement_areas": [
    "<string: Specific, constructive correction (e.g., 'Instead of saying X, say Y') in Japanese>"
  ],
  "alternative_phrases": [
    "<string: 2-3 English phrases that could have made their responses sound more native>"
  ]
}}
"""
    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        
        data = json.loads(text.strip())
        from schemas import ConversationEvaluationResponse
        return dict(
            overall_score=float(data.get("overall_score", 0)),
            summary=data.get("summary", "評価できませんでした。"),
            strengths=data.get("strengths", []),
            improvement_areas=data.get("improvement_areas", []),
            alternative_phrases=data.get("alternative_phrases", [])
        )
    except Exception as e:
        print(f"Error evaluating conversation: {e}")
        return dict(
            overall_score=0.0,
            summary="サーバーエラーにより評価できませんでした。\n通信状況を確認して再度お試しください。",
            strengths=[],
            improvement_areas=[],
            alternative_phrases=[]
        )
