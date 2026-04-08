import os
import json
import time

from dotenv import load_dotenv
import google.generativeai as genai

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
if api_key:
    genai.configure(api_key=api_key)

from database import SessionLocal, engine, Base
import models

def generate_phrases_for_scenario(chapter_title, grammar_points, cefr_level, scenario_title, scenario_desc, count=10):
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
Create {count} high-quality, natural conversational phrases that fit this specific scenario.
CRITICAL INSTRUCTION: You MUST ONLY output STATEMENTS (肯定文), NEGATIVE SENTENCES (否定文), and RESPONSES/REACTIONS (返答・相槌). 
DO NOT INCLUDE ANY QUESTIONS (疑問文) because we already have too many questions in our database. We need to balance it out.
Make the sentences feel like natural parts of a real dialogue.

Vary the difficulty across the {count} phrases (spread from 1 to 5).
The sentences should be extremely natural for spoken English in this situation.

Output ONLY a JSON array of {count} objects. Each object must have:
"japanese_text": "The sentence in Japanese",
"expected_english_text": "The natural English translation",
"grammar_point": "The main grammar point used",
"difficulty": <integer 1-5>
"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = model.generate_content(prompt)
            text = response.text.strip()
            # Clean up markdown if any
            if text.startswith("```json"): text = text[7:]
            if text.endswith("```"): text = text[:-3]
            text = text.strip()
            
            data_list = json.loads(text)
            if data_list and isinstance(data_list, list) and len(data_list) > 0:
                print(f"    [Success] Generated {len(data_list)} phrases for '{scenario_title}'", flush=True)
                return data_list[:count]
        except Exception as e:
            print(f"    [Attempt {attempt+1}] Error generating for '{scenario_title}': {e}", flush=True)
            time.sleep(3)
    return []

def run_append():
    print("Starting process to append conversational phrases...", flush=True)
    db = SessionLocal()
    try:
        chapters = db.query(models.Chapter).all()
        for chapter in chapters:
            print(f"\nProcessing Chapter {chapter.number}: {chapter.title}", flush=True)
            scenarios = db.query(models.Scenario).filter(models.Scenario.chapter_id == chapter.id).all()
            for scenario in scenarios:
                print(f"  -> Scenario: {scenario.title}", flush=True)
                questions_data = generate_phrases_for_scenario(
                    chapter_title=chapter.title,
                    grammar_points=chapter.grammar_points,
                    cefr_level=chapter.cefr_level,
                    scenario_title=scenario.title,
                    scenario_desc=scenario.description,
                    count=10
                )
                added = 0
                for q_data in questions_data:
                     if q_data.get("expected_english_text"):
                        q = models.Question(
                            japanese_text=q_data.get("japanese_text", ""),
                            expected_english_text=q_data.get("expected_english_text", ""),
                            grammar_point=q_data.get("grammar_point", ""),
                            difficulty=q_data.get("difficulty", 1),
                            chapter_id=chapter.id,
                            scenario_id=scenario.id
                        )
                        db.add(q)
                        added += 1
                db.commit()
                print(f"    ✅ Appended {added} new non-question phrases!", flush=True)
                time.sleep(1)
        print("\n🎉 Completed appending phrases to all scenarios!", flush=True)
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}", flush=True)
    finally:
        db.close()

if __name__ == "__main__":
    run_append()
