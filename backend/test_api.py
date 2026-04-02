import os
from database import SessionLocal
import models
import schemas
from main import get_chapter_detail

db = SessionLocal()
try:
    # Get any user to simulate
    user = db.query(models.User).first()
    if not user:
        print("No user found")
    else:
        print(f"Testing with user: {user.email}")
        res = get_chapter_detail(1, db, user)
        print("Title:", res.title)
        print("Scenarios length:", len(res.scenarios))
        for s in res.scenarios:
            print(f" - {s.title} (Status: {s.status})")
except Exception as e:
    import traceback
    traceback.print_exc()
finally:
    db.close()
