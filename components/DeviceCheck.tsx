"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Mic, Volume2, XCircle } from "lucide-react";
import { useSpeak } from "@/lib/useSpeech";

type St = "idle" | "ok" | "fail";

/** Non-blocking pre-flight: mic (with level meter), speaker, camera and speech-recognition support. */
export function DeviceCheck() {
  const [mic, setMic] = useState<St>("idle");
  const [cam, setCam] = useState<St>("idle");
  const [level, setLevel] = useState(0);
  const [sr] = useState(() => typeof window !== "undefined" && !!((window as unknown as Record<string, unknown>).SpeechRecognition || (window as unknown as Record<string, unknown>).webkitSpeechRecognition));
  const micStream = useRef<MediaStream | null>(null);
  const camStream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const video = useRef<HTMLVideoElement>(null);
  const { speak } = useSpeak();

  const stopAll = () => {
    cancelAnimationFrame(raf.current);
    micStream.current?.getTracks().forEach((t) => t.stop());
    camStream.current?.getTracks().forEach((t) => t.stop());
  };
  useEffect(() => stopAll, []);

  const testMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.current = stream;
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        const peak = Math.max(...buf.map((v) => Math.abs(v - 128)));
        setLevel(Math.min(100, peak * 2.2));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      setMic("ok");
    } catch {
      setMic("fail");
    }
  };

  const testCam = async () => {
    try {
      camStream.current = await navigator.mediaDevices.getUserMedia({ video: true });
      setCam("ok");
      requestAnimationFrame(() => {
        if (video.current) video.current.srcObject = camStream.current;
      });
    } catch {
      setCam("fail");
    }
  };

  return (
    <div className="grid gap-3 text-sm">
      <Row icon={<Mic size={16} />} title="Microphone" state={mic} action={mic === "ok" ? undefined : "Test"} onAction={testMic} okText="Speak — the bar should move" failText="Blocked. Allow the mic in your browser, or answer by typing.">
        {mic === "ok" && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-card"><div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${level}%` }} /></div>
        )}
      </Row>
      <Row icon={<Volume2 size={16} />} title="Speaker" state="idle" action="Play test" onAction={() => speak("Hello, can you hear me clearly?")} />
      <Row icon={<Camera size={16} />} title="Camera (optional)" state={cam} action={cam === "ok" ? undefined : "Test"} onAction={testCam} okText="Looking good" failText="Unavailable. You can join without it.">
        {cam === "ok" && <video ref={video} autoPlay muted playsInline className="mt-2 h-28 w-40 -scale-x-100 rounded-xl bg-black object-cover" />}
      </Row>
      <div className={`rounded-2xl p-3 ${sr ? "bg-soft" : "bg-danger/10 text-danger"}`}>
        {sr ? "Voice answers are supported in this browser." : "Voice answers aren't supported here (use Chrome, Edge or Safari). You can still type your answers."}
      </div>
    </div>
  );
}

function Row({ icon, title, state, action, onAction, okText, failText, children }: { icon: React.ReactNode; title: string; state: St; action?: string; onAction?: () => void; okText?: string; failText?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-soft p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-medium">{icon}{title}</span>
        <span className="flex items-center gap-2">
          {state === "ok" && <CheckCircle2 size={16} className="text-ok" />}
          {state === "fail" && <XCircle size={16} className="text-danger" />}
          {action && <button type="button" onClick={onAction} className="btn btn-ghost !bg-card !px-3 !py-1.5">{action}</button>}
        </span>
      </div>
      {state === "ok" && okText && <p className="mt-1 text-xs text-muted">{okText}</p>}
      {state === "fail" && failText && <p className="mt-1 text-xs text-danger">{failText}</p>}
      {children}
    </div>
  );
}
