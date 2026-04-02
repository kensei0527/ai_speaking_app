"""
Seed script for populating the curriculum.
This script sets up Chapters, Scenarios, and pre-generates Questions using AI.
Depending on the number of questions, this might take a few minutes to run.
"""
import os
import json
import time
from database import SessionLocal, engine, Base
import models
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

# Ensure tables exist
Base.metadata.create_all(bind=engine)

CHAPTERS = [
    {
        "number": 1,
        "title": "自己紹介・挨拶",
        "description": "英語での自己紹介や基本的な挨拶表現を学びます。be動詞や人称代名詞の基礎を固めましょう。",
        "grammar_points": "be動詞,人称代名詞,基本疑問文,所有格",
        "cefr_level": "A1",
        "prerequisite_chapter": None,
        "scenarios": [
            {"title": "新しい同僚への挨拶", "description": "職場でのカジュアルな挨拶"},
            {"title": "趣味について話す", "description": "初対面の人と趣味を共有する"},
            {"title": "家族について話す", "description": "自分の家族構成を説明する"}
        ]
    },
    {
        "number": 2,
        "title": "日常生活",
        "description": "毎日のルーティンや習慣について英語で表現する力をつけます。一般動詞の現在形を中心に学びます。",
        "grammar_points": "一般動詞(現在形),頻度の副詞,三人称単数,疑問詞(what/when/where)",
        "cefr_level": "A1",
        "prerequisite_chapter": 1,
        "scenarios": [
            {"title": "朝のルーティン", "description": "起きてから家を出るまで"},
            {"title": "週末の過ごし方", "description": "休日の習慣や活動"},
            {"title": "道案内", "description": "日常よくある場所を聞く・教える"}
        ]
    },
    {
        "number": 3,
        "title": "買い物・食事",
        "description": "ショッピングやレストランでの実用的な会話表現を習得します。数えられる名詞・数えられない名詞の区別も学びます。",
        "grammar_points": "可算名詞/不可算名詞,some/any,Would like,How much/How many",
        "cefr_level": "A2",
        "prerequisite_chapter": 2,
        "scenarios": [
            {"title": "レストランでの注文", "description": "メニューを見て注文する"},
            {"title": "服屋での買い物", "description": "サイズや色を尋ねる"},
            {"title": "スーパーでの買い物", "description": "食材の量や場所を聞く"}
        ]
    },
    {
        "number": 4,
        "title": "過去の出来事",
        "description": "昨日の出来事や思い出話を英語で語れるようになります。過去形と過去進行形を使い分ける練習をします。",
        "grammar_points": "過去形(規則/不規則),過去進行形,when/while,時間表現",
        "cefr_level": "A2",
        "prerequisite_chapter": 3,
        "scenarios": [
            {"title": "昨日の出来事", "description": "昨日何をしたか話す"},
            {"title": "子供の頃の思い出", "description": "昔の習慣や出来事を語る"},
            {"title": "旅行の感想", "description": "過去の旅行エピソードを話す"}
        ]
    },
    {
        "number": 5,
        "title": "未来・予定",
        "description": "予定や計画、予測について英語で表現します。will と be going to の使い分けをマスターしましょう。",
        "grammar_points": "will,be going to,現在進行形(未来用法),時・条件の副詞節",
        "cefr_level": "A2-B1",
        "prerequisite_chapter": 4,
        "scenarios": [
            {"title": "週末の予定", "description": "今週末のプランを話す"},
            {"title": "将来の夢", "description": "将来やりたいことについて語る"},
            {"title": "天気と予定の変更", "description": "状況に応じた予定の会話"}
        ]
    },
    {
        "number": 6,
        "title": "比較・意見",
        "description": "ものを比べたり、自分の意見を述べたりする表現を学びます。比較級・最上級の自然な使い方を身につけます。",
        "grammar_points": "比較級,最上級,as...as,I think that...,意見表明表現",
        "cefr_level": "B1",
        "prerequisite_chapter": 5,
        "scenarios": [
            {"title": "レストランの比較", "description": "どのお店が良いか比較する"},
            {"title": "映画の感想", "description": "意見を述べて議論する"},
            {"title": "製品レビュー", "description": "どちらの製品が優れているか語る"}
        ]
    },
    {
        "number": 7,
        "title": "仮定・条件",
        "description": "「もし〜だったら」という仮定表現を英語で使いこなせるようになります。仮定法の基礎から応用まで学びます。",
        "grammar_points": "仮定法現在,仮定法過去,if文,I wish,条件分岐表現",
        "cefr_level": "B1-B2",
        "prerequisite_chapter": 6,
        "scenarios": [
            {"title": "もし宝くじが当たったら", "description": "非現実的な願望を語る"},
            {"title": "アドバイスをする", "description": "「もし私なら〜する」と助言する"},
            {"title": "後悔について話す", "description": "「あの時〜していれば」を表現する"}
        ]
    },
    {
        "number": 8,
        "title": "ビジネス・メール",
        "description": "ビジネスシーンで使える丁寧な表現やメールの書き方を学びます。受動態やフォーマルな言い回しを身につけます。",
        "grammar_points": "受動態,丁寧表現(Could you/Would you),フォーマル表現,ビジネス慣用句",
        "cefr_level": "B2",
        "prerequisite_chapter": 7,
        "scenarios": [
            {"title": "会議での提案", "description": "フォーマルな場で意見を述べる"},
            {"title": "顧客への謝罪", "description": "丁寧な表現で対応する"},
            {"title": "電話対応", "description": "ビジネスでの電話の受け答え"}
        ]
    },
    {
        "number": 9,
        "title": "ニュース・時事",
        "description": "ニュースや時事問題について理解し、議論できるレベルの英語力を養います。複雑な文構造を読み解く力をつけます。",
        "grammar_points": "関係代名詞(who/which/that),分詞構文,複文構造,報告表現",
        "cefr_level": "B2-C1",
        "prerequisite_chapter": 8,
        "scenarios": [
            {"title": "環境問題", "description": "社会課題について議論する"},
            {"title": "最新テクノロジー", "description": "AIや新しい技術について語る"},
            {"title": "経済ニュースの要約", "description": "ニュース記事の内容を説明する"}
        ]
    },
    {
        "number": 10,
        "title": "抽象テーマ・議論",
        "description": "哲学的・社会的なテーマについて深い議論ができるレベルの英語力を目指します。高度な文法を駆使した表現を学びます。",
        "grammar_points": "仮定法過去完了,倒置,高度な接続表現,無生物主語,強調構文",
        "cefr_level": "C1",
        "prerequisite_chapter": 9,
        "scenarios": [
            {"title": "幸福論", "description": "何が人を幸せにするか議論する"},
            {"title": "文化の違い", "description": "異なる文化による価値観の差を語る"},
            {"title": "人生の選択", "description": "重大な決断とその影響について話す"}
        ]
    },
]


def generate_questions_for_scenario(chapter_title, grammar_points, cefr_level, scenario_title, scenario_desc, count=10):
    """Generate diverse questions for a specific scenario using Gemini API."""
    if not api_key:
        print("No API Key. Returning fallback data for scenario.")
        return [
            {
                "japanese_text": f"これはテストです({i})。",
                "expected_english_text": f"This is a test ({i}).",
                "grammar_point": grammar_points.split(",")[0],
                "difficulty": 1
            } for i in range(count)
        ]

    model = genai.GenerativeModel(
        'gemini-2.5-flash',
        generation_config={"response_mime_type": "application/json"}
    )

    prompt = f"""
You are an expert English teacher creating "Instant English Composition" (瞬間英作文) exercises.

## Chapter Info
- Theme: {chapter_title}
- Target Grammar: {grammar_points}
- CEFR Level: {cefr_level}

## Scenario Info
- Scenario Title: {scenario_title}
- Description: {scenario_desc}

## Instructions
Create {count} high-quality, natural questions that perfectly fit this specific scenario.
Use the target grammar points. Vary the difficulty across the {count} questions (spread from 1 to 5).
The sentences should be extremely natural for spoken English in this situation.

Output ONLY a JSON array of {count} objects. Each object must have:
"japanese_text": "The sentence in Japanese",
"expected_english_text": "The natural English translation",
"grammar_point": "The main grammar point used",
"difficulty": <integer 1-5>
"""

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        data_list = json.loads(text)
        return data_list[:count]
    except Exception as e:
        print(f"Error generating for scenario '{scenario_title}': {e}")
        return []


def seed():
    db = SessionLocal()
    try:
        existing_ch = db.query(models.Chapter).count()
        if existing_ch > 0:
            print("Database already has chapters. We will clear everything to re-seed.")
            # Clear data
            db.query(models.Attempt).delete()
            db.query(models.LessonQuestion).delete()
            db.query(models.Lesson).delete()
            db.query(models.UserScenarioProgress).delete()
            db.query(models.Question).delete()
            db.query(models.Scenario).delete()
            db.query(models.UserChapterProgress).delete()
            db.query(models.Chapter).delete()
            db.commit()

        print("Seeding chapters, scenarios, and generating questions...")

        for ch_data in CHAPTERS:
            print(f"Processing Chapter {ch_data['number']}: {ch_data['title']}")
            chapter = models.Chapter(
                number=ch_data["number"],
                title=ch_data["title"],
                description=ch_data["description"],
                grammar_points=ch_data["grammar_points"],
                cefr_level=ch_data["cefr_level"],
                prerequisite_chapter=ch_data["prerequisite_chapter"]
            )
            db.add(chapter)
            db.flush() # get chapter.id

            scenarios_data = ch_data.get("scenarios", [])
            for idx, sc_data in enumerate(scenarios_data):
                scenario = models.Scenario(
                    chapter_id=chapter.id,
                    title=sc_data["title"],
                    description=sc_data["description"],
                    order_index=idx
                )
                db.add(scenario)
                db.flush() # get scenario.id

                print(f"  -> Generating questions for scenario: {scenario.title}")
                # Generate 10 questions per scenario
                questions = generate_questions_for_scenario(
                    chapter_title=chapter.title,
                    grammar_points=chapter.grammar_points,
                    cefr_level=chapter.cefr_level,
                    scenario_title=scenario.title,
                    scenario_desc=scenario.description,
                    count=10
                )

                for q_data in questions:
                    q = models.Question(
                        japanese_text=q_data.get("japanese_text", ""),
                        expected_english_text=q_data.get("expected_english_text", ""),
                        grammar_point=q_data.get("grammar_point", ""),
                        difficulty=q_data.get("difficulty", 1),
                        chapter_id=chapter.id,
                        scenario_id=scenario.id
                    )
                    db.add(q)
                
                # Small pause to avoid hitting rate limits too quickly
                time.sleep(2)

        db.commit()
        print("✅ Successfully seeded all data.")
    except Exception as e:
        db.rollback()
        print(f"❌ Error seeding data: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed()
