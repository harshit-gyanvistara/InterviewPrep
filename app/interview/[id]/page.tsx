"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, CameraOff, Loader2, Mic, MicOff, PhoneOff, Send, StickyNote, Volume2, VolumeX } from "lucide-react";
import { db, uid, useAllPacks, useSettings } from "@/lib/db";
import { Lobby } from "@/components/Lobby";
import { NoteChip } from "@/components/NoteChip";
import { PERSONAS } from "@/lib/packs";
import { computeSignals } from "@/lib/analysis";
import { useListen, useSpeak } from "@/lib/useSpeech";
import { useNotesPanel } from "@/lib/notesContext";
import { useConfirm } from "@/lib/dialogContext";
import type { Message, Profile, Report, Session } from "@/lib/types";

const fmt = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

export default function InterviewRoom() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { openPanel } = useNotesPanel();
  const confirm = useConfirm();

  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [voice, setVoice] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const sessionRef = useRef<Session | null>(null);
  const voiceRef = useRef(true);
  const startedRef = useRef(false);
  const finishingRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);

  const { settings } = useSettings();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  });
  const { byId } = useAllPacks();
  const byIdRef = useRef(byId);
  useEffect(() => {
    byIdRef.current = byId;
  });
  const speech = useSpeak();
  const persist = useCallback(async (mut: (s: Session) => Session) => {
    const cur = sessionRef.current;
    if (!cur) return;
    const next = mut(cur);
    sessionRef.current = next;
    setSession(next);
    await db.sessions.put(next);
  }, []);

  // ---- load
  useEffect(() => {
    (async () => {
      const [s, p] = await Promise.all([db.sessions.get(id), db.profiles.list()]);
      if (!s || !p[0]) return router.replace("/");
      if (s.status === "done") return router.replace(`/report/${s.id}`);
      if (s.status === "scoring") s.status = "active"; // refreshed mid-scoring: re-enter the room
      sessionRef.current = s;
      setSession(s);
      setProfile(p[0]);
    })();
  }, [id, router]);

  const pack = session ? byId(session.config.packId) : undefined;
  const persona = session ? PERSONAS[session.config.persona] : undefined;

  // ---- finish & score
  const finish = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || !profile || finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    setError(null);
    speech.cancel();
    streamRef.current?.getTracks().forEach((t) => t.stop());

    const answered = s.messages.some((m) => m.role === "candidate");
    if (!answered) {
      await db.sessions.remove(s.id);
      return router.replace("/practice");
    }
    await persist((x) => ({ ...x, status: "scoring", endedAt: Date.now() }));
    try {
      const scored = await post<Omit<Report, "id" | "sessionId" | "packId" | "createdAt" | "signals">>("/api/interview/report", {
        config: s.config,
        profile,
        pack: byIdRef.current(s.config.packId),
        messages: s.messages,
        code: s.code,
      });
      const report: Report = {
        ...scored,
        id: uid(),
        sessionId: s.id,
        packId: s.config.packId,
        createdAt: Date.now(),
        signals: computeSignals(s.messages),
      };
      await db.reports.put(report);
      await persist((x) => ({ ...x, status: "done", reportId: report.id }));
      router.replace(`/report/${s.id}`);
    } catch (e) {
      finishingRef.current = false;
      setFinishing(false);
      await persist((x) => ({ ...x, status: "active", endedAt: undefined }));
      setError(e instanceof Error ? e.message : "Scoring failed");
    }
  }, [profile, persist, router, speech]);

  // ---- voice input: fills the text box live, never sends on its own — the person always hits Send
  const listen = useListen((t) => setText(t), settings.recognitionLang);
  const listenRef = useRef(listen);
  useEffect(() => {
    listenRef.current = listen;
  });

  const requestTurn = useCallback(
    async (messages: Message[]) => {
      const s = sessionRef.current;
      if (!s || !profile) return;
      setBusy(true);
      setError(null);
      try {
        const out = await post<{ reply: string; endInterview: boolean }>("/api/interview/turn", {
          config: s.config,
          profile,
          pack: byIdRef.current(s.config.packId),
          messages,
          elapsedSec: (Date.now() - s.startedAt) / 1000,
          code: s.code,
        });
        const msg: Message = { id: uid(), role: "interviewer", text: out.reply, at: Date.now() - s.startedAt };
        await persist((x) => ({ ...x, messages: [...x.messages, msg] }));
        const after = () => {
          if (out.endInterview) finish();
          else if (voiceRef.current && settingsRef.current.autoListen && listenRef.current.supported) listenRef.current.start();
        };
        if (voiceRef.current) speech.speak(out.reply, { gender: s.config.persona === "friendly" ? "f" : "m", rate: settingsRef.current.speechRate, voiceName: settingsRef.current.voiceName, onEnd: after });
        else after();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setBusy(false);
      }
    },
    [profile, persist, speech, finish],
  );

  function submit(raw: string) {
    const t = raw.trim();
    const s = sessionRef.current;
    if (!t || !s || finishingRef.current) return;
    speech.cancel();
    listenRef.current.stop();
    setText("");
    const msg: Message = { id: uid(), role: "candidate", text: t, at: Date.now() - s.startedAt };
    const messages = [...s.messages, msg];
    persist((x) => ({ ...x, messages })).then(() => requestTurn(messages));
  }

  // opening question (guarded against StrictMode double-run)
  useEffect(() => {
    if (!session || !profile || session.status !== "active" || startedRef.current) return;
    startedRef.current = true;
    if (session.messages.length === 0) setTimeout(() => requestTurn([]), 0);
  }, [session, profile, requestTurn]);

  // ---- timer
  useEffect(() => {
    const t = setInterval(() => {
      const s = sessionRef.current;
      if (!s || s.status !== "active" || finishingRef.current) return;
      const e = (Date.now() - s.startedAt) / 1000;
      setElapsed(e);
      if (e > s.config.durationMin * 60 + 45) finish();
    }, 1000);
    return () => clearInterval(t);
  }, [finish]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages.length]);

  // ---- camera
  const toggleCam = async () => {
    if (camOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setCamOn(false);
      return;
    }
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: true });
      setCamOn(true);
    } catch {
      setError("Camera unavailable or permission denied. You can continue without it.");
    }
  };
  useEffect(() => {
    if (camOn && videoRef.current && streamRef.current) videoRef.current.srcObject = streamRef.current;
  }, [camOn]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  const toggleVoice = () => {
    const next = !voice;
    setVoice(next);
    voiceRef.current = next;
    if (!next) {
      speech.cancel();
      listen.stop();
    }
  };

  const join = async () => {
    const st = settingsRef.current;
    voiceRef.current = st.voiceReply;
    setVoice(st.voiceReply);
    await persist((x) => ({ ...x, status: "active", startedAt: Date.now() }));
    if (st.cameraDefault) toggleCam();
  };

  const cancelLobby = async () => {
    await db.sessions.remove(id);
    router.replace("/practice");
  };

  const endClicked = async () => {
    const talked = (sessionRef.current?.messages.filter((m) => m.role === "candidate").length ?? 0) > 0;
    const msg = talked ? "End the interview now and get your report?" : "You haven't answered anything yet. Leave without a report?";
    if (!settingsRef.current.confirmEnd || (await confirm({ message: msg, confirmLabel: "End interview", danger: !talked }))) finish();
  };

  if (!session || !profile || !pack || !persona) return null;
  if (session.status === "lobby") return <Lobby pack={pack} config={session.config} onJoin={join} onCancel={cancelLobby} />;

  const total = session.config.durationMin * 60;
  const left = total - elapsed;
  const last = [...session.messages].reverse().find((m) => m.role === "interviewer");
  const isCoding = pack.roundType === "coding";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-2xl font-light tracking-tight sm:text-4xl">{pack.title}</h1>
            <p className="text-sm text-muted">{persona.name} · {persona.label}{session.config.pressure ? " · Pressure mode" : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <NoteChip link={{ type: "session", id: session.id, label: pack.title }} />
            {settings.showTimer && (
              <div className={`rounded-full px-4 py-2 font-mono text-sm ${left < 60 ? "bg-danger text-white" : "bg-card"}`}>
                {left >= 0 ? fmt(left) : `+${fmt(-left)}`}
              </div>
            )}
          </div>
        </div>

        {/* video stage */}
        <div className="relative aspect-video overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-300/70 via-violet-200/70 to-sky-200/70 dark:from-indigo-900 dark:via-slate-800 dark:to-slate-900">
          <div className="absolute inset-0 grid place-items-center">
            <div className={`grid h-28 w-28 place-items-center rounded-full bg-accent text-4xl font-semibold text-accent-ink sm:h-40 sm:w-40 sm:text-6xl ${speech.speaking ? "pulse-ring" : ""}`}>
              {persona.name[0]}
            </div>
          </div>
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-xs text-white">
            {persona.name}
            {speech.speaking && (
              <span className="wave flex h-4 items-center">
                {[0, 0.15, 0.3, 0.1].map((d, i) => (
                  <span key={i} style={{ animationDelay: `${d}s` }} />
                ))}
              </span>
            )}
          </div>
          {busy && (
            <div className="absolute left-4 top-12 flex items-center gap-2 rounded-full bg-black/45 px-3 py-1 text-xs text-white">
              <Loader2 size={12} className="animate-spin" /> thinking…
            </div>
          )}

          <div className="absolute right-4 top-4 h-28 w-20 overflow-hidden rounded-2xl bg-slate-800 shadow-lg sm:h-40 sm:w-32">
            {camOn ? (
              <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-2xl font-semibold text-white/80">{profile.name[0]?.toUpperCase()}</div>
            )}
            <span className="absolute bottom-1 left-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">You</span>
          </div>

          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/45 p-2 backdrop-blur">
            <RoundBtn onClick={toggleCam} active={camOn} label="Camera">{camOn ? <Camera size={18} /> : <CameraOff size={18} />}</RoundBtn>
            <RoundBtn onClick={toggleVoice} active={voice} label="Spoken interviewer">{voice ? <Volume2 size={18} /> : <VolumeX size={18} />}</RoundBtn>
            <RoundBtn
              onClick={() => (listen.listening ? listen.stop() : (speech.cancel(), listen.start(text)))}
              active={listen.listening}
              disabled={!listen.supported || finishing}
              label={listen.supported ? (listen.listening ? "Stop and edit" : "Speak your answer") : "Voice input not supported in this browser (use Chrome/Edge/Safari)"}
            >
              {listen.listening ? <Mic size={18} /> : <MicOff size={18} />}
            </RoundBtn>
            <button onClick={endClicked} disabled={finishing} className="grid h-11 w-14 place-items-center rounded-full bg-danger text-white disabled:opacity-50" title="End interview">
              <PhoneOff size={18} />
            </button>
          </div>
        </div>

        {/* live caption */}
        <div className={`rounded-3xl bg-card p-5 ${settings.captions ? "" : "hidden"}`}>
          <p className="min-h-14 text-base leading-relaxed sm:text-lg">
            {last ? <span className="rounded bg-hl px-1">{last.text}</span> : <span className="text-muted">Waiting for your interviewer…</span>}
          </p>
          {listen.listening && <p className="mt-2 flex items-center gap-1.5 text-sm text-ok">Listening… your words are appearing in the answer box on the right. Tap the mic again when you&apos;re done to review and edit before sending.</p>}
        </div>

        {isCoding && (
          <div className="rounded-3xl bg-card p-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-medium">Code editor</span>
              <span className="text-xs text-muted">The interviewer reads this on every turn. Think aloud as you write.</span>
            </div>
            <textarea
              spellCheck={false}
              value={session.code}
              onChange={(e) => persist((x) => ({ ...x, code: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Tab") {
                  e.preventDefault();
                  const el = e.currentTarget;
                  const { selectionStart: a, selectionEnd: b } = el;
                  persist((x) => ({ ...x, code: x.code.slice(0, a) + "  " + x.code.slice(b) })).then(() => {
                    el.selectionStart = el.selectionEnd = a + 2;
                  });
                }
              }}
              placeholder="// write your solution here"
              className="min-h-56 w-full resize-y rounded-2xl bg-slate-950 p-4 font-mono text-sm text-slate-100 outline-none"
            />
          </div>
        )}

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-danger/10 p-4 text-sm text-danger">
            <span>{error}</span>
            <button
              className="btn btn-ghost"
              onClick={() => (session.status === "active" && session.messages.length ? (finishingRef.current ? finish() : requestTurn(session.messages)) : requestTurn([]))}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* room chat / transcript */}
      <aside className="flex h-[70vh] min-h-96 flex-col rounded-3xl bg-card p-4 lg:h-auto lg:max-h-[calc(100vh-9rem)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-light">Transcript</h2>
          <span className="text-xs text-muted">{session.messages.length} turns</span>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {session.messages.map((m) => (
            <div key={m.id} className={`group relative max-w-[92%] rounded-2xl px-4 py-3 pr-8 text-sm ${m.role === "candidate" ? "ml-auto bg-accent text-accent-ink" : "bg-soft"}`}>
              <div className="mb-0.5 text-xs opacity-60">{m.role === "candidate" ? "You" : persona.name}</div>
              {m.text}
              <button
                onClick={() => openPanel({ filterLink: { type: "session", id: session.id, label: pack.title }, prefillBody: `"${m.text}"\n— ${m.role === "candidate" ? "you" : persona.name}` })}
                aria-label="Save as note"
                title="Save as note"
                className={`absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full opacity-0 transition group-hover:opacity-100 ${m.role === "candidate" ? "hover:bg-black/10" : "hover:bg-card"}`}
              >
                <StickyNote size={13} />
              </button>
            </div>
          ))}
          <div ref={chatEnd} />
        </div>
        {listen.listening && (
          <p className="mb-1.5 flex items-center gap-1.5 text-xs text-ok">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ok" /> Listening — tap the mic to stop and edit before sending.
          </p>
        )}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <input
            className="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={listen.listening ? "Listening…" : "Type your answer, or use the mic, then hit send…"}
            disabled={busy || finishing || listen.listening}
            title={listen.listening ? "Tap the mic to stop listening before editing" : undefined}
          />
          <button className="btn btn-primary !px-3" disabled={!text.trim() || busy || finishing} aria-label="Send answer">
            <Send size={16} />
          </button>
        </form>
      </aside>

      {finishing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-6 text-white">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 animate-spin" size={36} />
            <p className="text-lg">Scoring your interview…</p>
            <p className="mt-1 text-sm opacity-70">Writing evidence-based feedback. This takes about 20–40 seconds.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RoundBtn({ children, onClick, active, disabled, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; disabled?: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`grid h-11 w-11 place-items-center rounded-full transition disabled:opacity-40 ${active ? "bg-white text-black" : "bg-white/15 text-white hover:bg-white/25"}`}
    >
      {children}
    </button>
  );
}
