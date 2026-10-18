import { ImageResponse } from "next/og";

// The preview card shown when a build-score.com link is shared (WhatsApp, LinkedIn, Slack, X).
// File convention: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md

export const alt = "Offerly: mock interviews with an AI interviewer and a scored report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#111113";
const MUTED = "#5f6168";
const ACCENT = "#3b4bdb";
const LINE = "#e7e5e4";
const OK = "#15703a";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#fafaf9", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 620 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="34" height="34" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="5.5" stroke="#fff" strokeWidth="2" />
                <path d="M5.6 8.2l1.7 1.7 3.2-3.4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: INK, letterSpacing: -1 }}>Offerly</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ fontSize: 64, fontWeight: 700, color: INK, lineHeight: 1.08, letterSpacing: -2 }}>Walk into your interview</div>
            <div style={{ fontSize: 64, fontWeight: 700, color: ACCENT, lineHeight: 1.08, letterSpacing: -2 }}>already practised.</div>
            <div style={{ fontSize: 28, color: MUTED, lineHeight: 1.4 }}>Talk to an AI interviewer, then get a scored report that shows exactly what to fix.</div>
          </div>
          <div style={{ fontSize: 24, color: MUTED }}>build-score.com</div>
        </div>

        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 380, background: "#fff", border: `2px solid ${LINE}`, borderRadius: 24, padding: 36, gap: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <div style={{ width: 120, height: 120, borderRadius: 60, border: `12px solid ${OK}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 44, fontWeight: 700, color: INK }}>74</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 18, color: OK, fontWeight: 700 }}>Ready</div>
                <div style={{ fontSize: 22, color: INK, fontWeight: 600 }}>Behavioural round</div>
              </div>
            </div>
            {[
              ["Technical depth", 81, OK],
              ["Trade-offs", 54, "#b45309"],
              ["Structure", 48, "#b91c1c"],
            ].map(([label, w, c]) => (
              <div key={label as string} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, color: MUTED }}>
                  <span>{label}</span>
                  <span>{((w as number) / 10).toFixed(1)}</span>
                </div>
                <div style={{ display: "flex", height: 10, background: "#f4f4f2", borderRadius: 5 }}>
                  <div style={{ width: `${w}%`, background: c as string, borderRadius: 5 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
