"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the Web Speech API (not in lib.dom for all TS versions).
interface SR extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >;
      }) => void)
    | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SR;

const getCtor = (): SRCtor | undefined =>
  typeof window === "undefined"
    ? undefined
    : ((
        window as unknown as {
          SpeechRecognition?: SRCtor;
          webkitSpeechRecognition?: SRCtor;
        }
      ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SRCtor })
        .webkitSpeechRecognition);

/**
 * Speech-to-text. Never submits anything itself — it just keeps calling `onUpdate` with the
 * transcript so far (finalised speech + whatever is currently being recognised) so the caller
 * can show it in an editable text box. The mic stays open across pauses (continuous=true);
 * the person decides when to stop listening and when to hit send, so they always get a chance
 * to review or fix the text before it goes anywhere.
 */
export function useListen(onUpdate: (text: string) => void, lang = "en-IN") {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const bufferRef = useRef(""); // finalised speech only, this session
  const cbRef = useRef(onUpdate);
  const langRef = useRef(lang);
  useEffect(() => {
    cbRef.current = onUpdate;
    langRef.current = lang;
  });

  const supported = typeof window !== "undefined" && !!getCtor();

  const stop = useCallback(() => {
    recRef.current?.stop(); // graceful stop: lets the browser flush a final result first
  }, []);

  /** `seed` is the text already in the box (e.g. typed, or left from a previous voice segment) to keep and append to. */
  const start = useCallback((seed = "") => {
    const Ctor = getCtor();
    if (!Ctor || recRef.current) return;
    const rec = new Ctor();
    rec.lang = langRef.current;
    rec.continuous = true;
    rec.interimResults = true;
    bufferRef.current = seed ? seed.trim() + " " : "";
    setError(null);

    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) bufferRef.current += r[0].transcript + " ";
        else interimText += r[0].transcript;
      }
      cbRef.current((bufferRef.current + interimText).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech") return; // silence is normal with continuous listening, keep going
      if (e.error !== "aborted") setError(e.error);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
    }
  }, []);

  useEffect(() => () => recRef.current?.abort(), []);

  return { supported, listening, error, start, stop };
}

/** Text-to-speech using the browser's built-in voices. */
export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);

  const speak = useCallback(
    (
      text: string,
      opts?: {
        gender?: "f" | "m";
        rate?: number;
        voiceName?: string;
        onEnd?: () => void;
      },
    ) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        opts?.onEnd?.();
        return;
      }
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis
        .getVoices()
        .filter((v) => v.lang.startsWith("en"));
      const want =
        opts?.gender === "m"
          ? /male|daniel|alex|david|google uk english male/i
          : /female|samantha|zira|karen|google uk english female|google us english/i;
      const v =
        (opts?.voiceName && voices.find((x) => x.name === opts.voiceName)) ||
        voices.find((x) => want.test(x.name)) ||
        voices[0];
      if (v) u.voice = v;
      u.rate = opts?.rate ?? 1;
      u.onstart = () => setSpeaking(true);
      const done = () => {
        setSpeaking(false);
        opts?.onEnd?.();
      };
      u.onend = done;
      u.onerror = done;
      window.speechSynthesis.speak(u);
    },
    [],
  );

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  useEffect(() => cancel, [cancel]);

  return { speaking, speak, cancel };
}
