"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

const RESTART_DELAY_MS = 250;

interface UseBrowserSpeechRecognitionOptions {
  lang?: string;
  onFinalTranscript: (text: string) => void;
}

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function subscribeToSpeechSupport() {
  return () => {};
}

function getSpeechSupportSnapshot() {
  return Boolean(getSpeechRecognitionConstructor());
}

function getSpeechSupportServerSnapshot() {
  return false;
}

function getSpeechErrorMessage(error: string) {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "マイクの使用が許可されませんでした。";
    case "audio-capture":
      return "マイクを検出できませんでした。";
    case "network":
      return "音声認識の接続に失敗しました。";
    case "language-not-supported":
      return "この言語の音声認識に対応していません。";
    default:
      return "音声入力を開始できませんでした。";
  }
}

export function useBrowserSpeechRecognition({
  lang = "en-US",
  onFinalTranscript,
}: UseBrowserSpeechRecognitionOptions) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const wantsListeningRef = useRef(false);
  const listeningRef = useRef(false);
  const restartTimerRef = useRef<number | null>(null);
  const requestStartRef = useRef<() => void>(() => {});
  const onFinalTranscriptRef = useRef(onFinalTranscript);

  const supported = useSyncExternalStore(
    subscribeToSpeechSupport,
    getSpeechSupportSnapshot,
    getSpeechSupportServerSnapshot
  );
  const [listening, setListeningState] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  const setListening = useCallback((next: boolean) => {
    listeningRef.current = next;
    setListeningState(next);
  }, []);

  const resetInterim = useCallback(() => {
    setInterimTranscript("");
  }, []);

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const createRecognition = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setError("このブラウザでは音声入力を使えません。");
      return null;
    }

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setListening(true);
      setError("");
    };

    recognition.onresult = (event) => {
      let finalTranscript = "";
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }

      const cleanedFinalTranscript = finalTranscript.trim();
      if (cleanedFinalTranscript) {
        onFinalTranscriptRef.current(cleanedFinalTranscript);
      }
      setInterimTranscript(interim.trim());
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;

      setError(event.message || getSpeechErrorMessage(event.error));
      if (
        event.error === "not-allowed" ||
        event.error === "service-not-allowed" ||
        event.error === "audio-capture"
      ) {
        wantsListeningRef.current = false;
      }
    };

    recognition.onend = () => {
      setListening(false);
      if (!wantsListeningRef.current) return;

      clearRestartTimer();
      restartTimerRef.current = window.setTimeout(() => {
        requestStartRef.current();
      }, RESTART_DELAY_MS);
    };

    return recognition;
  }, [clearRestartTimer, lang, setListening]);

  const start = useCallback(() => {
    wantsListeningRef.current = true;
    setError("");
    resetInterim();
    clearRestartTimer();

    const recognition = recognitionRef.current ?? createRecognition();
    if (!recognition) return;
    recognitionRef.current = recognition;

    if (listeningRef.current) return;

    try {
      recognition.start();
    } catch (err) {
      if (err instanceof DOMException && err.name === "InvalidStateError") return;

      wantsListeningRef.current = false;
      setListening(false);
      setError(err instanceof Error ? err.message : "音声入力を開始できませんでした。");
    }
  }, [clearRestartTimer, createRecognition, resetInterim, setListening]);

  const stop = useCallback(() => {
    wantsListeningRef.current = false;
    clearRestartTimer();
    resetInterim();

    const recognition = recognitionRef.current;
    if (!recognition) {
      setListening(false);
      return;
    }

    try {
      recognition.stop();
    } catch {
      recognition.abort();
    }
    setListening(false);
  }, [clearRestartTimer, resetInterim, setListening]);

  useEffect(() => {
    requestStartRef.current = start;
  }, [start]);

  useEffect(() => {
    return () => {
      wantsListeningRef.current = false;
      clearRestartTimer();
      recognitionRef.current?.abort();
    };
  }, [clearRestartTimer]);

  return {
    supported,
    listening,
    interimTranscript,
    error,
    start,
    stop,
    resetInterim,
  };
}
