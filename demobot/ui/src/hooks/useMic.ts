// ui/src/hooks/useMic.ts
//
// Encapsulates real-time microphone dictation via the browser SpeechRecognition API.
//
// Usage:
//   const { recording, error, startRecording, stopRecording } = useMic((text) => setInput(text));
//

import { useState, useRef, useCallback, useEffect } from "react";

// Standard Web Speech API types
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onerror: ((this: SpeechRecognition, ev: any) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => any) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: { new (): SpeechRecognition };
    webkitSpeechRecognition?: { new (): SpeechRecognition };
  }
}

export interface UseMicResult {
  recording: boolean;
  error: string | null;
  supported: boolean;
  startRecording: () => void;
  stopRecording: () => void;
}

export function useMic(onTranscript: (text: string) => void): UseMicResult {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  // Keep callback ref fresh without re-triggering effects
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const supported =
    typeof window !== "undefined" &&
    (!!window.SpeechRecognition || !!window.webkitSpeechRecognition);

  useEffect(() => {
    if (!supported) return;

    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRec) {
      const recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true; // Stream results as they come in
      recognition.lang = "en-US";

      recognition.onresult = (event) => {
        let fullTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          fullTranscript += event.results[i][0].transcript;
        }
        onTranscriptRef.current(fullTranscript);
      };

      recognition.onerror = (event: any) => {
        if (event.error === "no-speech") return;
        setError(`Speech recognition error: ${event.error}`);
        setRecording(false);
      };

      recognition.onend = () => {
        setRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, [supported]);

  const startRecording = useCallback(() => {
    setError(null);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setRecording(true);
      } catch (err) {
        // ignore if already started
        setRecording(true);
      }
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current && recording) {
      recognitionRef.current.stop();
      setRecording(false);
    }
  }, [recording]);

  return { recording, error, supported, startRecording, stopRecording };
}
