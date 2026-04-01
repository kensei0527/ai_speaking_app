import os
import sys

# Add backend to path so imports work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from models import Base
from database import engine
from ai_service import generate_question, evaluate_answer

import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

try:
    for m in genai.list_models():
        if "generateContent" in m.supported_generation_methods:
            print(m.name)
except Exception as e:
    print("Error:", e)

print("Testing evaluate_answer...")
try:
    eval = evaluate_answer("これはペンです", "This is a pen", "This is a pen", "BE verb")
    print("Evaluated answer:", eval)
except Exception as e:
    print("Error in evaluate:", repr(e))
