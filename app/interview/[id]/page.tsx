"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, CameraOff, Loader2, Mic, MicOff, PhoneOff, Send, StickyNote, Volume2, VolumeX } from "lucide-react";
import { db, getAuth, uid, useAllPacks, useSettings } from "@/lib/db";
import { Lobby } from "@/components/Lobby";
import { NoteChip } from "@/components/NoteChip";
import { PERSONAS } from "@/lib/packs";
import { computeSignals } from "@/lib/analysis";
import { useListen, useSpeak } from "@/lib/useSpeech";
import { useNotesPanel } from "@/lib/notesContext";
import { useConfirm } from "@/lib/dialogContext";
import type { Message, Pack, Profile, Report, Session } from "@/lib/types";

const fmt = (s: number) => `${String(Math.floor(Math.max(0, s) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;

async function post<T>(url: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    // 409: the session's first save hasn't reached the server yet; give the save queue a moment.
    if (res.status === 409 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json as T;
  }
}

/**
 * The interview's context, sent only when signed out (AUTH_MODE=off). Signed in, the server loads it
 * from the database and the browser sends just the session id and the new answer (M2.6).
 */
async function browserContext(s: Session, profile: Profile, pack: Pack | undefined, messages: Message[]) {
  const auth = await getAuth();
  if (auth.mode === "supabase" && auth.user) return undefined;
  return { config: s.config, profile, pack, messages };
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
        sessionId: s.id,
        code: s.code,
        context: await browserContext(s, profile, byIdRef.current(s.config.packId), s.messages),
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
    async (answer?: Message) => {
      const s = sessionRef.current;
      if (!s || !profile) return;
      setBusy(true);
      setError(null);
      try {
        // The server adds the answer and the reply to its copy and returns the reply as a message,
        // so both copies keep the same ids.
        const out = await post<{ reply: string; endInterview: boolean; message: Message }>("/api/interview/turn", {
          sessionId: s.id,
          answer: answer && { id: answer.id, text: answer.text, at: answer.at },
          elapsedSec: (Date.now() - s.startedAt) / 1000,
          code: s.code,
          context: await browserContext(s, profile, byIdRef.current(s.config.packId), s.messages.filter((m) => m.id !== answer?.id)),
        });
        await persist((x) => ({ ...x, messages: [...x.messages, out.message] }));
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

  // Retrying resends the last answer if it got no reply; the server won't add it twice.
  function retryTurn() {
    const last = sessionRef.current?.messages.at(-1);
    return requestTurn(last?.role === "candidate" ? last : undefined);
  }

  function submit(raw: string) {
    const t = raw.trim();
    const s = sessionRef.current;
    if (!t || !s || finishingRef.current) return;
    speech.cancel();
    listenRef.current.stop();
    setText("");
    const msg: Message = { id: uid(), role: "candidate", text: t, at: Date.now() - s.startedAt };
    persist((x) => ({ ...x, messages: [...x.messages, msg] })).then(() => requestTurn(msg));
  }

  // opening question (guarded against StrictMode double-run)
  useEffect(() => {
    if (!session || !profile || !pack || session.status !== "active" || startedRef.current) return;
    startedRef.current = true;
    if (session.messages.length === 0) setTimeout(() => requestTurn(), 0);
  }, [session, profile, pack, requestTurn]);

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
  const questionNo = session.messages.filter((m) => m.role === "interviewer").length;
  // One clear state for the room, shown on the interviewer tile and next to the answer box.
  const state = finishing
    ? { label: "Scoring", cls: "bg-soft text-muted" }
    : speech.speaking
      ? { label: `${persona.name} is speaking`, cls: "bg-accent-soft text-accent" }
      : busy
        ? { label: `${persona.name} is thinking`, cls: "bg-soft text-muted" }
        : listen.listening
          ? { label: "Listening to you", cls: "bg-ok-soft text-ok" }
          : { label: "Your turn", cls: "bg-ok-soft text-ok" };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
      <div className="grid min-w-0 content-start gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{pack.title}</h1>
            <p className="text-sm text-muted">
              {persona.name} · {persona.label}{session.config.pressure ? " · Pressure mode" : ""}
              {questionNo > 0 ? ` · Question ${questionNo}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <NoteChip link={{ type: "session", id: session.id, label: pack.title }} />
            {settings.showTimer && (
              <div
                className={`rounded-lg px-3 py-1.5 font-mono text-sm font-medium tabular-nums ${left < 60 ? "bg-danger-soft text-danger" : "bg-card text-ink ring-1 ring-line"}`}
                aria-label={left >= 0 ? `${fmt(left)} left` : `${fmt(-left)} over time`}
              >
                {left >= 0 ? fmt(left) : `+${fmt(-left)}`}
              </div>
            )}
          </div>
        </div>

        {/* stage: interviewer tile, your camera, current question */}
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          <div className="relative grid min-h-64 place-items-center bg-gradient-to-b from-accent-soft/70 to-card px-4 py-10 sm:min-h-80">
            <div className="grid justify-items-center gap-3 text-center">
              <div className={`grid h-24 w-24 place-items-center rounded-full bg-accent text-4xl font-semibold text-accent-ink sm:h-32 sm:w-32 sm:text-5xl ${speech.speaking ? "pulse-ring" : ""}`}>
                {persona.name[0]}
              </div>
              <div className="text-sm font-medium">{persona.name}</div>
              <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${state.cls}`} aria-live="polite">
                {speech.speaking ? (
                  <span className="wave flex h-3.5 items-center text-accent">
                    {[0, 0.15, 0.3, 0.1].map((d, i) => (
                      <span key={i} style={{ animationDelay: `${d}s` }} />
                    ))}
                  </span>
                ) : busy ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <span className={`h-1.5 w-1.5 rounded-full bg-current ${listen.listening ? "animate-pulse" : ""}`} />
                )}
                {state.label}
              </span>
            </div>

            <div className="absolute right-3 top-3 h-24 w-[72px] overflow-hidden rounded-lg border border-line bg-soft sm:h-32 sm:w-24">
              {camOn ? (
                <video ref={videoRef} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-xl font-semibold text-muted">{profile.name[0]?.toUpperCase()}</div>
              )}
              <span className="absolute bottom-1 left-1 rounded bg-card/90 px-1.5 py-0.5 text-[10px] font-medium">You</span>
            </div>
          </div>

          {settings.captions && (
            <div className="border-t border-line px-5 py-4 sm:px-6">
              <div className="text-xs font-semibold text-muted">{questionNo > 0 ? `Question ${questionNo}` : "Starting"}</div>
              <p className="mt-1 min-h-12 text-[17px] leading-7 sm:text-lg">
                {last ? last.text : <span className="text-muted">Waiting for your interviewer…</span>}
              </p>
              {listen.listening && (
                <p className="mt-2 text-sm text-ok">Your words appear in the answer box. Tap the mic again when you&apos;re done, then review and send.</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-center gap-2 border-t border-line bg-soft/60 px-4 py-3">
            <RoundBtn onClick={toggleCam} active={camOn} label={camOn ? "Turn camera off" : "Turn camera on"}>{camOn ? <Camera size={18} /> : <CameraOff size={18} />}</RoundBtn>
            <RoundBtn onClick={toggleVoice} active={voice} label={voice ? "Mute interviewer voice" : "Unmute interviewer voice"}>{voice ? <Volume2 size={18} /> : <VolumeX size={18} />}</RoundBtn>
            <RoundBtn
              onClick={() => (listen.listening ? listen.stop() : (speech.cancel(), listen.start(text)))}
              active={listen.listening}
              primary
              disabled={!listen.supported || finishing}
              label={listen.supported ? (listen.listening ? "Stop and edit" : "Speak your answer") : "Voice input not supported in this browser (use Chrome, Edge or Safari)"}
            >
              {listen.listening ? <Mic size={18} /> : <MicOff size={18} />}
            </RoundBtn>
            <button onClick={endClicked} disabled={finishing} className="ml-2 inline-flex h-11 items-center gap-2 rounded-full bg-danger px-4 text-sm font-medium text-on-status disabled:opacity-50" title="End interview">
              <PhoneOff size={16} /> <span className="hidden sm:inline">End</span>
            </button>
          </div>
        </div>

        {isCoding && (
          <div className="rounded-xl border border-line bg-card p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-semibold">Code editor</span>
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
              className="min-h-56 w-full resize-y rounded-lg border border-line bg-[#0e0f12] p-4 font-mono text-sm text-[#ededef] outline-none focus:border-accent"
            />
          </div>
        )}

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-danger-soft p-4 text-sm text-danger">
            <span>{error}</span>
            <button
              className="btn btn-ghost"
              onClick={() => (session.status === "active" && session.messages.length ? (finishingRef.current ? finish() : retryTurn()) : requestTurn())}
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {/* transcript and answer box */}
      <aside className="flex h-[70vh] min-h-96 flex-col rounded-xl border border-line bg-card lg:sticky lg:top-0 lg:h-[calc(100vh-8.5rem)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold">Transcript</h2>
          <span className="text-xs tabular-nums text-muted">{session.messages.length} turns</span>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {session.messages.map((m) => (
            <div key={m.id} className={`group relative max-w-[92%] rounded-xl px-3.5 py-2.5 pr-8 text-sm ${m.role === "candidate" ? "ml-auto bg-accent-soft" : "bg-soft"}`}>
              <div className={`mb-0.5 text-xs font-medium ${m.role === "candidate" ? "text-accent" : "text-muted"}`}>{m.role === "candidate" ? "You" : persona.name}</div>
              {m.text}
              <button
                onClick={() => openPanel({ filterLink: { type: "session", id: session.id, label: pack.title }, prefillBody: `"${m.text}"\n— ${m.role === "candidate" ? "you" : persona.name}` })}
                aria-label="Save as note"
                title="Save as note"
                className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full text-muted opacity-0 transition hover:bg-card focus-visible:opacity-100 group-hover:opacity-100"
              >
                <StickyNote size={13} />
              </button>
            </div>
          ))}
          <div ref={chatEnd} />
        </div>
        <form
          className="grid gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(text);
          }}
        >
          <span className={`w-fit rounded-full px-2.5 py-0.5 text-xs font-medium ${state.cls}`}>{state.label}</span>
          <div className="flex items-center gap-2">
            <input
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={listen.listening ? "Listening…" : "Type your answer, or use the mic"}
              disabled={busy || finishing || listen.listening}
              title={listen.listening ? "Tap the mic to stop listening before editing" : undefined}
            />
            <button className="btn btn-primary !px-3" disabled={!text.trim() || busy || finishing} aria-label="Send answer">
              <Send size={16} />
            </button>
          </div>
        </form>
      </aside>

      {finishing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-bg/85 p-6 backdrop-blur-sm">
          <div className="text-center">
            <Loader2 className="mx-auto mb-4 animate-spin text-accent" size={36} />
            <p className="text-lg">Scoring your interview…</p>
            <p className="mt-1 text-sm text-muted">Writing evidence-based feedback. This takes about 20–40 seconds.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RoundBtn({ children, onClick, active, primary, disabled, label }: { children: React.ReactNode; onClick: () => void; active?: boolean; primary?: boolean; disabled?: boolean; label: string }) {
  // The mic is the main control: filled in the accent colour; the others stay quiet until switched on.
  const look = primary
    ? active ? "bg-ok text-on-status" : "bg-accent text-accent-ink hover:opacity-90"
    : active ? "bg-card text-ink ring-1 ring-line" : "bg-transparent text-muted ring-1 ring-line hover:bg-card hover:text-ink";
  return (
    <button onClick={onClick} disabled={disabled} title={label} aria-label={label} aria-pressed={active} className={`grid h-11 w-11 place-items-center rounded-full transition disabled:opacity-40 ${look}`}>
      {children}
    </button>
  );
}
