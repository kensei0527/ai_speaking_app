import os
import sys
import tempfile
import unittest
from unittest.mock import patch

TEST_DB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
TEST_DB.close()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.name}"

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import database
import main
import models
import placement_service
import schemas
from fastapi import HTTPException


class PlacementFlowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models.Base.metadata.create_all(bind=database.engine)

    @classmethod
    def tearDownClass(cls):
        try:
            os.unlink(TEST_DB.name)
        except OSError:
            pass

    def setUp(self):
        self.db = database.SessionLocal()
        for model in [
            models.PlacementAnswer,
            models.PlacementSession,
            models.PlacementQuestion,
            models.LessonQuestion,
            models.Lesson,
            models.Attempt,
            models.UserScenarioProgress,
            models.UserChapterProgress,
            models.Question,
            models.Scenario,
            models.User,
            models.Chapter,
        ]:
            self.db.query(model).delete()
        self.db.commit()
        self._seed_curriculum()

    def tearDown(self):
        self.db.close()

    def _seed_curriculum(self):
        chapters = [
            (1, "A1 Basics", "A1", "be動詞,一般動詞"),
            (2, "A2 Daily", "A2", "過去形,疑問詞"),
            (3, "B1 Opinions", "B1", "条件文,比較級"),
            (4, "B2 Work", "B2", "受動態,目的表現"),
            (5, "C1 Abstract", "C1", "抽象表現,譲歩表現"),
        ]
        for number, title, level, grammar in chapters:
            chapter = models.Chapter(
                number=number,
                title=title,
                description=title,
                grammar_points=grammar,
                cefr_level=level,
            )
            self.db.add(chapter)
            self.db.flush()
            scenario = models.Scenario(
                chapter_id=chapter.id,
                title=f"{title} Scenario",
                description="Practice scenario",
                order_index=0,
            )
            self.db.add(scenario)
            self.db.flush()
            for index in range(12):
                difficulty = (index % 5) + 1
                self.db.add(models.Question(
                    japanese_text=f"{title} question {index}",
                    expected_english_text=f"{title} answer {index}",
                    grammar_point=grammar.split(",")[0],
                    difficulty=difficulty,
                    chapter_id=chapter.id,
                    scenario_id=scenario.id,
                ))
        self.db.commit()

    def _user(self, level="A1", placement_status="pending"):
        user = models.User(
            id="user-1",
            email="user@example.com",
            name="Test User",
            cefr_level=level,
            placement_status=placement_status,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user

    def test_determine_cefr_level_thresholds(self):
        self.assertEqual(
            placement_service.determine_cefr_level({
                "A1": 80,
                "A2": 75,
                "B1": 66,
                "B2": 50,
                "C1": 40,
                "C2": 40,
            }),
            "B1",
        )
        self.assertEqual(
            placement_service.determine_cefr_level({
                "A1": 90,
                "A2": 90,
                "B1": 90,
                "B2": 90,
                "C1": 75,
                "C2": 74,
            }),
            "C1",
        )
        self.assertEqual(
            placement_service.determine_cefr_level({
                "A1": 90,
                "A2": 90,
                "B1": 90,
                "B2": 90,
                "C1": 75,
                "C2": 75,
            }),
            "C2",
        )

    def test_new_user_defaults_to_pending(self):
        user = self._user()
        self.assertEqual(user.placement_status, "pending")
        self.assertEqual(user.cefr_level, "A1")

    def test_placement_start_hides_expected_answers(self):
        user = self._user()
        response = main.start_placement(db=self.db, user=user)
        self.assertEqual(response.total_questions, 12)
        self.assertFalse(hasattr(response.questions[0], "expected_english_text"))

    def test_placement_complete_rejects_bad_answer_sets(self):
        user = self._user()
        response = main.start_placement(db=self.db, user=user)
        with self.assertRaises(HTTPException) as missing_error:
            main.complete_placement(
                response.session_id,
                schemas.PlacementCompleteRequest(
                    answers=[schemas.PlacementAnswerItem(question_id=response.questions[0].id, user_answer="Hello")]
                ),
                db=self.db,
                user=user,
            )
        self.assertEqual(missing_error.exception.status_code, 400)

        duplicate_answer = schemas.PlacementAnswerItem(question_id=response.questions[0].id, user_answer="Hello")
        with self.assertRaises(HTTPException) as duplicate_error:
            main.complete_placement(
                response.session_id,
                schemas.PlacementCompleteRequest(answers=[duplicate_answer, duplicate_answer]),
                db=self.db,
                user=user,
            )
        self.assertEqual(duplicate_error.exception.status_code, 400)

    def test_placement_complete_sets_level_and_unlocks_accessible_chapters(self):
        user = self._user()
        response = main.start_placement(db=self.db, user=user)
        question_map = {
            question.id: self.db.query(models.PlacementQuestion).filter(models.PlacementQuestion.id == question.id).first()
            for question in response.questions
        }
        scores = {
            "A1": 80,
            "A2": 80,
            "B1": 70,
            "B2": 45,
            "C1": 40,
            "C2": 30,
        }

        def fake_evaluate(japanese, expected_english, user_answer, grammar_point):
            question = next(q for q in question_map.values() if q.japanese_text == japanese)
            score = scores[question.cefr_level]
            return schemas.EvaluationResponse(
                is_correct=score >= 70,
                score=score,
                evaluation_level="Great" if score >= 70 else "Try Again",
                feedback_text="ok",
                expected_english=expected_english,
                grammar_point=grammar_point,
            )

        answers = [
            schemas.PlacementAnswerItem(question_id=question.id, user_answer="Answer")
            for question in response.questions
        ]
        with patch.object(main.ai_service, "evaluate_answer", side_effect=fake_evaluate):
            result = main.complete_placement(
                response.session_id,
                schemas.PlacementCompleteRequest(answers=answers),
                db=self.db,
                user=user,
            )

        self.assertEqual(result.cefr_level, "B1")
        self.db.refresh(user)
        self.assertEqual(user.placement_status, "completed")
        self.assertEqual(user.cefr_level, "B1")
        progress = self.db.query(models.UserChapterProgress).filter(
            models.UserChapterProgress.user_id == user.id
        ).all()
        status_by_level = {
            p.chapter.cefr_level: p.status
            for p in progress
        }
        self.assertEqual(status_by_level["A1"], "available")
        self.assertEqual(status_by_level["A2"], "available")
        self.assertEqual(status_by_level["B1"], "available")
        self.assertEqual(status_by_level["B2"], "locked")

    def test_lesson_start_includes_intro_and_prefers_user_difficulty(self):
        user = self._user(level="B1", placement_status="completed")
        chapter = self.db.query(models.Chapter).filter(models.Chapter.cefr_level == "B1").first()
        scenario = self.db.query(models.Scenario).filter(models.Scenario.chapter_id == chapter.id).first()

        response = main.start_lesson(
            schemas.LessonStartRequest(scenario_id=scenario.id),
            db=self.db,
            user=user,
        )

        self.assertIsNotNone(response.lesson_intro)
        preferred_count = sum(1 for question in response.questions if question.difficulty in (3, 4))
        self.assertEqual(preferred_count, 4)
        self.assertEqual(response.total_questions, 10)


if __name__ == "__main__":
    unittest.main()
