from database import SessionLocal
import models

def reset_all_progress():
    db = SessionLocal()
    try:
        print("Resetting all learning data from Supabase...")
        db.query(models.Attempt).delete()
        db.query(models.LessonQuestion).delete()
        db.query(models.Lesson).delete()
        db.query(models.UserScenarioProgress).delete()
        db.query(models.UserChapterProgress).delete()
        
        # Reset users' overall score
        users = db.query(models.User).all()
        for u in users:
            u.proficiency_score = 0.0
            
        db.commit()
        print("✅ All learning progress has been successfully reset.")
    except Exception as e:
        db.rollback()
        print("❌ Error resetting data:", e)
    finally:
        db.close()

if __name__ == "__main__":
    reset_all_progress()
