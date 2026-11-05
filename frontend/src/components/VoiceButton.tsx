import { Mic, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Spinner } from "./ui";

/* Voice input for the description.
   1. Browser speech recognition (Chrome, Edge, Safari) — instant, free, works in Indian languages.
   2. Otherwise record a clip and let Gemini transcribe it (Firefox etc.). */

export const VOICE_LANGS = [
  { code: "en-IN", label: "English" },
  { code: "hi-IN", label: "हिन्दी" },
  { code: "kn-IN", label: "ಕನ್ನಡ" },
  { code: "ta-IN", label: "தமிழ்" },
  { code: "te-IN", label: "తెలుగు" },
  { code: "ml-IN", label: "മലയാളം" },
  { code: "mr-IN", label: "मराठी" },
  { code: "bn-IN", label: "বাংলা" },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SR = any;
const SpeechRecognition: SR =
  typeof window !== "undefined" ? (window as SR).SpeechRecognition || (window as SR).webkitSpeechRecognition : null;

export function VoiceButton({
  lang, aiEnabled, onText, onError,
}: {
  lang: string;
  aiEnabled: boolean;
  onText: (text: string, final: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [state, setState] = useState<"idle" | "listening" | "transcribing">("idle");
  const recRef = useRef<SR>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);

  useEffect(() => () => {
    recRef.current?.abort?.();
    mediaRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, []);

  const supported = Boolean(SpeechRecognition) || (aiEnabled && typeof MediaRecorder !== "undefined");
  if (!supported) return null;

  async function start() {
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = true;
      let committed = "";
      rec.onresult = (e: SR) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) committed += t + " ";
          else interim += t;
        }
        onText((committed + interim).trim(), false);
      };
      rec.onerror = (e: SR) => {
        if (e.error === "not-allowed") onError("Microphone access is blocked. Allow it in the browser's address bar.");
        else if (e.error !== "aborted" && e.error !== "no-speech") onError(`Voice input stopped (${e.error}).`);
      };
      rec.onend = () => {
        onText(committed.trim(), true);
        setState("idle");
      };
      recRef.current = rec;
      rec.start();
      setState("listening");
      return;
    }
    // Fallback: record and send to Gemini.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("transcribing");
        try {
          const fd = new FormData();
          fd.append("audio", new Blob(chunks, { type: rec.mimeType }), "voice");
          const { text } = await api<{ text: string }>("/api/ai/transcribe", { body: fd });
          onText(text, true);
        } catch (err) {
          onError((err as Error).message);
        }
        setState("idle");
      };
      mediaRef.current = rec;
      rec.start();
      setState("listening");
    } catch {
      onError("Microphone access is blocked. Allow it in the browser's address bar.");
    }
  }

  function stop() {
    recRef.current?.stop?.();
    if (mediaRef.current?.state === "recording") mediaRef.current.stop();
  }

  const listening = state === "listening";
  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      disabled={state === "transcribing"}
      aria-pressed={listening}
      className={`inline-flex items-center gap-2 h-9 rounded-full px-3.5 text-sm font-semibold transition ${
        listening ? "bg-danger text-white" : "bg-civic-soft text-civic hover:bg-civic/15"
      }`}
    >
      {state === "transcribing" ? <Spinner size={16} /> : listening ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}
      {state === "transcribing" ? "Transcribing…" : listening ? "Stop" : "Speak"}
      {listening && <span className="relative flex size-2"><span className="absolute inset-0 rounded-full bg-white animate-ping" /><span className="relative size-2 rounded-full bg-white" /></span>}
    </button>
  );
}
