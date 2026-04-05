"""
conversation_service.py
─────────────────────────────────────────────────────────────────────────────
Gemini Live API との WebSocket プロキシ。
既存の ai_service.py / main.py の問題生成・採点フローには一切干渉しません。

アーキテクチャ:
  Browser  ←── WebSocket ──→  FastAPI (this proxy)  ←── WSS ──→  Gemini Live API
  (audio PCM chunks, JSON msgs)                        (wss://generativelanguage.googleapis.com)
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import websockets
from typing import Optional


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
LIVE_API_MODEL = "gemini-3.1-flash-live-preview"
LIVE_WS_URL = (
    f"wss://generativelanguage.googleapis.com/ws/"
    f"google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
    f"?key={GEMINI_API_KEY}"
)


def build_system_prompt(chapter_title: str, phrases: list[str]) -> str:
    """
    章のタイトルと、ユーザーが実際に学んだフレーズのリストから
    Gemini へのシステムプロンプトを生成する。
    """
    phrase_list = "\n".join(f"  - {p}" for p in phrases) if phrases else "  (なし)"
    return f"""You are a friendly and encouraging English conversation coach.

The student has just completed Chapter: "{chapter_title}" in their English learning app.
During this chapter they practiced these English phrases:
{phrase_list}

Your mission:
1. Have a natural, casual spoken conversation with the student.
2. Naturally weave in opportunities for the student to use (or hear) the phrases above.
3. If the student uses one of the phrases correctly, praise them briefly.
4. If they make a small grammar mistake, gently correct with a natural suggestion (don't lecture).
5. Keep responses SHORT (1-3 sentences) to feel like a real conversation, not a lecture.
6. Speak at a clear, moderate pace.
7. Start with a warm greeting related to the chapter topic: "{chapter_title}".

IMPORTANT: This is a SPOKEN conversation — respond conversationally, not like written text.
Do NOT use bullet points, markdown, or lists in your spoken responses.
"""


def build_setup_message(chapter_title: str, phrases: list[str]) -> dict:
    """Gemini Live API へ最初に送る config メッセージ（BidiGenerateContentSetup）を構築する。"""
    return {
        "setup": {
            "model": f"models/{LIVE_API_MODEL}",
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {"voiceName": "Aoede"}
                    }
                },
            },
            "systemInstruction": {
                "parts": [{"text": build_system_prompt(chapter_title, phrases)}]
            },
        }
    }


async def proxy_live_session(
    client_ws,  # FastAPI WebSocket (starlette)
    chapter_title: str,
    phrases: list[str],
):
    """
    ブラウザ ↔ このプロキシ ↔ Gemini Live API の双方向中継。

    フロントから受け取るメッセージ形式:
      { "type": "audio",  "data": "<base64 PCM 16kHz>" }
      { "type": "text",   "data": "<string>" }
      { "type": "end" }     ← セッション終了合図

    フロントへ送るメッセージ形式:
      { "type": "audio",       "data": "<base64 PCM 24kHz>" }
      { "type": "transcript",  "role": "user"|"model", "text": "..." }
      { "type": "error",       "message": "..." }
      { "type": "connected" }
      { "type": "stopped" }
    """
    try:
        async with websockets.connect(
            LIVE_WS_URL,
            ping_interval=None,  # Live API manages its own keep-alive
            max_size=10 * 1024 * 1024,  # 10 MB (audio chunks can be large)
        ) as gemini_ws:
            # 1. Gemini へ初期設定を送信
            setup_msg = build_setup_message(chapter_title, phrases)
            await gemini_ws.send(json.dumps(setup_msg))

            # 2. Gemini から setupComplete が届くまで待機（最大 5 秒）
            try:
                raw = await asyncio.wait_for(gemini_ws.recv(), timeout=5.0)
                resp = json.loads(raw)
                if "setupComplete" not in resp:
                    await client_ws.send_json({"type": "error", "message": "Gemini setup failed."})
                    return
            except asyncio.TimeoutError:
                await client_ws.send_json({"type": "error", "message": "Gemini setup timed out."})
                return

            # 3. 接続成功を通知
            await client_ws.send_json({"type": "connected"})

            # ── 2 方向を同時に処理する非同期タスク ─────────────────────────

            async def forward_client_to_gemini():
                """ブラウザ → Gemini"""
                try:
                    while True:
                        raw_msg = await client_ws.receive_text()
                        msg = json.loads(raw_msg)
                        msg_type = msg.get("type", "")

                        if msg_type == "audio":
                            gemini_msg = {
                                "realtimeInput": {
                                    "audio": {
                                        "data": msg["data"],
                                        "mimeType": "audio/pcm;rate=16000",
                                    }
                                }
                            }
                            await gemini_ws.send(json.dumps(gemini_msg))

                        elif msg_type == "text":
                            gemini_msg = {
                                "realtimeInput": {"text": msg["data"]}
                            }
                            await gemini_ws.send(json.dumps(gemini_msg))

                        elif msg_type == "end":
                            break

                except Exception:
                    pass  # Connection closed by client

            async def forward_gemini_to_client():
                """Gemini → ブラウザ"""
                try:
                    async for raw in gemini_ws:
                        resp = json.loads(raw)
                        server_content = resp.get("serverContent", {})

                        # Audio チャンク
                        model_turn = server_content.get("modelTurn", {})
                        for part in model_turn.get("parts", []):
                            inline = part.get("inlineData")
                            if inline and inline.get("mimeType", "").startswith("audio/"):
                                await client_ws.send_json({
                                    "type": "audio",
                                    "data": inline["data"],
                                })

                        # ユーザー音声のテキスト転写
                        input_tx = server_content.get("inputTranscription")
                        if input_tx and input_tx.get("text"):
                            await client_ws.send_json({
                                "type": "transcript",
                                "role": "user",
                                "text": input_tx["text"],
                            })

                        # AI の発話テキスト転写
                        output_tx = server_content.get("outputTranscription")
                        if output_tx and output_tx.get("text"):
                            await client_ws.send_json({
                                "type": "transcript",
                                "role": "model",
                                "text": output_tx["text"],
                            })

                except Exception:
                    pass  # Gemini closed the connection

            # 2 タスクを並行実行
            tasks = [
                asyncio.create_task(forward_client_to_gemini()),
                asyncio.create_task(forward_gemini_to_client()),
            ]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in tasks:
                t.cancel()

    except Exception as e:
        try:
            await client_ws.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass

    finally:
        try:
            await client_ws.send_json({"type": "stopped"})
        except Exception:
            pass
