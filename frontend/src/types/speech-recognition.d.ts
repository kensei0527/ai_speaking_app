export {};

declare global {
  interface BrowserSpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface BrowserSpeechRecognitionResult {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): BrowserSpeechRecognitionAlternative;
    [index: number]: BrowserSpeechRecognitionAlternative;
  }

  interface BrowserSpeechRecognitionResultList {
    readonly length: number;
    item(index: number): BrowserSpeechRecognitionResult;
    [index: number]: BrowserSpeechRecognitionResult;
  }

  interface BrowserSpeechRecognitionEvent extends Event {
    readonly resultIndex: number;
    readonly results: BrowserSpeechRecognitionResultList;
  }

  interface BrowserSpeechRecognitionErrorEvent extends Event {
    readonly error: string;
    readonly message?: string;
  }

  interface BrowserSpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onstart: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
    onend: ((this: BrowserSpeechRecognition, event: Event) => void) | null;
    onerror:
      | ((this: BrowserSpeechRecognition, event: BrowserSpeechRecognitionErrorEvent) => void)
      | null;
    onresult:
      | ((this: BrowserSpeechRecognition, event: BrowserSpeechRecognitionEvent) => void)
      | null;
    start(): void;
    stop(): void;
    abort(): void;
  }

  interface BrowserSpeechRecognitionConstructor {
    new (): BrowserSpeechRecognition;
  }

  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}
