from __future__ import annotations

import os
import json
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
    topic: str | None = None
) -> QuestionBase:
    """
    Generates a new Japanese-English problem based on:
    - Chapter theme and grammar points
    - User's per-chapter proficiency score
    - Recent attempt history (last 10)
    - Identified weak grammar points
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

    # Topic override
    topic_instruction = (
        f"特に以下のトピックにフォーカスしてください: {topic}"
        if topic
        else "章のテーマと文法範囲から適切な問題を選んでください。"
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

## 指示:
{topic_instruction}

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


def evaluate_answer(
    japanese: str,
    expected_english: str,
    user_answer: str,
    grammar_point: str
) -> EvaluationResponse:
    """
    Evaluates the user's answer against the expected answer and Japanese text.
    """
    model = get_model()

    prompt = f"""
You are an expert English teacher evaluating a student's answer in an "Instant English Composition" exercise.

Task:
Original Japanese: "{japanese}"
Target Grammar Point: "{grammar_point}"
Model/Expected English Answer: "{expected_english}"

Student's Answer: "{user_answer}"

Analyze the student's answer focusing on:
1. Correctness of meaning compared to the Japanese.
2. Proper use of the target grammar point.
3. Naturalness.

If the student's answer is perfectly acceptable and natural, it can be marked correct even if it differs slightly from the Expected English.

Output ONLY a JSON object with the following keys:
"is_correct": <boolean: true if acceptable/correct, false if major errors>,
"score": <number between 0 and 100 based on accuracy and naturalness>,
"feedback_text": "A brief, encouraging explanation in Japanese pointing out what was good and any corrections needed."
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
            feedback_text=data.get("feedback_text", "Could not analyze the answer."),
            expected_english=expected_english,
            grammar_point=grammar_point
        )
    except Exception as e:
        print(f"Error evaluating answer: {e}")
        return EvaluationResponse(
            is_correct=False,
            score=0,
            feedback_text="サーバーエラーにより添削できませんでした。(Server Error)",
            expected_english=expected_english,
            grammar_point=grammar_point
        )
