"""
Seed script for populating the 10 chapters of the curriculum.
Run once: python seed_chapters.py
"""
from database import SessionLocal, engine, Base
import models

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
    },
    {
        "number": 2,
        "title": "日常生活",
        "description": "毎日のルーティンや習慣について英語で表現する力をつけます。一般動詞の現在形を中心に学びます。",
        "grammar_points": "一般動詞(現在形),頻度の副詞,三人称単数,疑問詞(what/when/where)",
        "cefr_level": "A1",
        "prerequisite_chapter": 1,
    },
    {
        "number": 3,
        "title": "買い物・食事",
        "description": "ショッピングやレストランでの実用的な会話表現を習得します。数えられる名詞・数えられない名詞の区別も学びます。",
        "grammar_points": "可算名詞/不可算名詞,some/any,Would like,How much/How many",
        "cefr_level": "A2",
        "prerequisite_chapter": 2,
    },
    {
        "number": 4,
        "title": "過去の出来事",
        "description": "昨日の出来事や思い出話を英語で語れるようになります。過去形と過去進行形を使い分ける練習をします。",
        "grammar_points": "過去形(規則/不規則),過去進行形,when/while,時間表現",
        "cefr_level": "A2",
        "prerequisite_chapter": 3,
    },
    {
        "number": 5,
        "title": "未来・予定",
        "description": "予定や計画、予測について英語で表現します。will と be going to の使い分けをマスターしましょう。",
        "grammar_points": "will,be going to,現在進行形(未来用法),時・条件の副詞節",
        "cefr_level": "A2-B1",
        "prerequisite_chapter": 4,
    },
    {
        "number": 6,
        "title": "比較・意見",
        "description": "ものを比べたり、自分の意見を述べたりする表現を学びます。比較級・最上級の自然な使い方を身につけます。",
        "grammar_points": "比較級,最上級,as...as,I think that...,意見表明表現",
        "cefr_level": "B1",
        "prerequisite_chapter": 5,
    },
    {
        "number": 7,
        "title": "仮定・条件",
        "description": "「もし〜だったら」という仮定表現を英語で使いこなせるようになります。仮定法の基礎から応用まで学びます。",
        "grammar_points": "仮定法現在,仮定法過去,if文,I wish,条件分岐表現",
        "cefr_level": "B1-B2",
        "prerequisite_chapter": 6,
    },
    {
        "number": 8,
        "title": "ビジネス・メール",
        "description": "ビジネスシーンで使える丁寧な表現やメールの書き方を学びます。受動態やフォーマルな言い回しを身につけます。",
        "grammar_points": "受動態,丁寧表現(Could you/Would you),フォーマル表現,ビジネス慣用句",
        "cefr_level": "B2",
        "prerequisite_chapter": 7,
    },
    {
        "number": 9,
        "title": "ニュース・時事",
        "description": "ニュースや時事問題について理解し、議論できるレベルの英語力を養います。複雑な文構造を読み解く力をつけます。",
        "grammar_points": "関係代名詞(who/which/that),分詞構文,複文構造,報告表現",
        "cefr_level": "B2-C1",
        "prerequisite_chapter": 8,
    },
    {
        "number": 10,
        "title": "抽象テーマ・議論",
        "description": "哲学的・社会的なテーマについて深い議論ができるレベルの英語力を目指します。高度な文法を駆使した表現を学びます。",
        "grammar_points": "仮定法過去完了,倒置,高度な接続表現,無生物主語,強調構文",
        "cefr_level": "C1",
        "prerequisite_chapter": 9,
    },
]


def seed():
    db = SessionLocal()
    try:
        existing = db.query(models.Chapter).count()
        if existing > 0:
            print(f"Chapters already seeded ({existing} found). Clearing and re-seeding...")
            db.query(models.Chapter).delete()
            db.commit()

        for ch_data in CHAPTERS:
            chapter = models.Chapter(**ch_data)
            db.add(chapter)

        db.commit()
        print(f"✅ Successfully seeded {len(CHAPTERS)} chapters.")
    except Exception as e:
        db.rollback()
        print(f"❌ Error seeding chapters: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
