from __future__ import annotations

import json
from typing import Iterable

CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

LEVEL_DIFFICULTY_RANGES: dict[str, tuple[int, int]] = {
    "A1": (1, 2),
    "A2": (2, 3),
    "B1": (3, 4),
    "B2": (4, 5),
    "C1": (4, 5),
    "C2": (4, 5),
}

LEVEL_RANK: dict[str, int] = {level: index for index, level in enumerate(CEFR_LEVELS)}

PLACEMENT_QUESTIONS = [
    {
        "cefr_level": "A1",
        "japanese_text": "私は東京出身です。",
        "expected_english_text": "I am from Tokyo.",
        "grammar_point": "be動詞",
        "difficulty": 1,
    },
    {
        "cefr_level": "A1",
        "japanese_text": "彼女は毎朝コーヒーを飲みます。",
        "expected_english_text": "She drinks coffee every morning.",
        "grammar_point": "一般動詞(現在形)",
        "difficulty": 2,
    },
    {
        "cefr_level": "A2",
        "japanese_text": "昨日、友達と映画を見ました。",
        "expected_english_text": "I watched a movie with my friend yesterday.",
        "grammar_point": "過去形",
        "difficulty": 2,
    },
    {
        "cefr_level": "A2",
        "japanese_text": "駅までどうやって行けばいいですか。",
        "expected_english_text": "How can I get to the station?",
        "grammar_point": "疑問詞",
        "difficulty": 3,
    },
    {
        "cefr_level": "B1",
        "japanese_text": "時間があれば、明日その資料を確認します。",
        "expected_english_text": "If I have time, I will check the document tomorrow.",
        "grammar_point": "条件文",
        "difficulty": 3,
    },
    {
        "cefr_level": "B1",
        "japanese_text": "このアプリは前のバージョンより使いやすいと思います。",
        "expected_english_text": "I think this app is easier to use than the previous version.",
        "grammar_point": "比較級",
        "difficulty": 4,
    },
    {
        "cefr_level": "B2",
        "japanese_text": "会議が延期された理由を説明していただけますか。",
        "expected_english_text": "Could you explain why the meeting was postponed?",
        "grammar_point": "受動態",
        "difficulty": 4,
    },
    {
        "cefr_level": "B2",
        "japanese_text": "締め切りに間に合うように、優先順位を見直す必要があります。",
        "expected_english_text": "We need to review our priorities so that we can meet the deadline.",
        "grammar_point": "目的表現",
        "difficulty": 5,
    },
    {
        "cefr_level": "C1",
        "japanese_text": "十分な情報がなければ、説得力のある結論を出すのは難しいです。",
        "expected_english_text": "Without enough information, it is difficult to draw a convincing conclusion.",
        "grammar_point": "抽象表現",
        "difficulty": 5,
    },
    {
        "cefr_level": "C1",
        "japanese_text": "経済状況が改善したにもかかわらず、多くの家庭は依然として不安を抱えています。",
        "expected_english_text": "Although the economic situation has improved, many households still feel insecure.",
        "grammar_point": "譲歩表現",
        "difficulty": 5,
    },
    {
        "cefr_level": "C2",
        "japanese_text": "その提案は一見合理的に見えるものの、長期的な影響を過小評価しています。",
        "expected_english_text": "While the proposal may seem reasonable at first glance, it underestimates the long-term impact.",
        "grammar_point": "高度な譲歩表現",
        "difficulty": 5,
    },
    {
        "cefr_level": "C2",
        "japanese_text": "彼の発言は、問題の本質を明らかにするどころか、議論をさらに曖昧にしました。",
        "expected_english_text": "Far from clarifying the core issue, his remarks made the discussion even more ambiguous.",
        "grammar_point": "倒置・強調表現",
        "difficulty": 5,
    },
]


def normalize_cefr_level(level: str | None) -> str:
    if not level:
        return "A1"
    normalized = level.upper()
    if normalized in LEVEL_RANK:
        return normalized
    if normalized.startswith("A2"):
        return "A2"
    if normalized.startswith("B1"):
        return "B1"
    if normalized.startswith("B2"):
        return "B2"
    if normalized.startswith("C1"):
        return "C1"
    if normalized.startswith("C2"):
        return "C2"
    return "A1"


def difficulty_range_for_level(level: str | None) -> tuple[int, int]:
    return LEVEL_DIFFICULTY_RANGES[normalize_cefr_level(level)]


def determine_cefr_level(level_scores: dict[str, float]) -> str:
    normalized_scores = {
        level: float(level_scores.get(level, 0.0) or 0.0)
        for level in CEFR_LEVELS
    }

    if normalized_scores["C1"] >= 75 and normalized_scores["C2"] >= 75:
        return "C2"

    result = "A1"
    for level in CEFR_LEVELS[:-1]:
        level_index = LEVEL_RANK[level]
        lower_levels = CEFR_LEVELS[:level_index]
        lower_passed = all(normalized_scores[lower] >= 60 for lower in lower_levels)
        if normalized_scores[level] >= 65 and lower_passed:
            result = level
    return result


def average_score(scores: Iterable[float]) -> float:
    score_list = [float(score or 0.0) for score in scores]
    if not score_list:
        return 0.0
    return round(sum(score_list) / len(score_list), 1)


def can_access_chapter_level(user_level: str | None, chapter_level: str | None) -> bool:
    user_rank = LEVEL_RANK[normalize_cefr_level(user_level)]
    chapter_rank = LEVEL_RANK[normalize_cefr_level(chapter_level)]
    return chapter_rank <= user_rank


def build_default_lesson_intro(chapter_title: str, scenario_title: str, grammar_points: str) -> dict:
    grammar_list = [point.strip() for point in grammar_points.split(",") if point.strip()]
    primary = grammar_list[0] if grammar_list else "今日の表現"
    phrase = scenario_title if scenario_title else chapter_title
    return {
        "title": f"{scenario_title}で使う表現",
        "body": (
            f"このレッスンでは「{phrase}」の場面で、{primary}を使って短く自然に返す練習をします。"
            "まず場面で使いやすい型を確認してから、英作文に入りましょう。"
        ),
        "phrases": [
            {
                "phrase": "I would like ...",
                "meaning": "〜をお願いします / 〜したいです",
                "usage_note": "丁寧に希望を伝えたい時に使います。",
                "example": "I would like a table for two.",
            },
            {
                "phrase": "Could you ...?",
                "meaning": "〜していただけますか",
                "usage_note": "相手に依頼するときの自然で丁寧な始め方です。",
                "example": "Could you tell me where it is?",
            },
        ],
    }


def parse_lesson_intro_phrases(raw_value: str | None) -> list[dict]:
    if not raw_value:
        return []
    try:
        value = json.loads(raw_value)
    except Exception:
        return []
    if not isinstance(value, list):
        return []
    phrases = []
    for item in value:
        if isinstance(item, dict):
            phrases.append(
                {
                    "phrase": str(item.get("phrase", "")),
                    "meaning": str(item.get("meaning", "")),
                    "usage_note": str(item.get("usage_note", "")),
                    "example": str(item.get("example", "")),
                }
            )
    return phrases
