import { NextResponse } from "next/server";
import { ApiError, MODELS, Type, generateJson } from "@/lib/gemini";
import { PERSONAS } from "@/lib/packs";
import { isValidPack, scoringSystem, transcriptText } from "@/lib/prompts";
import type { AnswerReview, DimensionScore, Message, Pack, Profile, Report, SessionConfig } from "@/lib/types";

type Scored = Pick<Report, "overall" | "verdict" | "summary" | "strengths" | "topFixes"> & {
  dimensions: DimensionScore[];
  answerReviews: AnswerReview[];
};

const str = { type: Type.STRING };
const num = { type: Type.NUMBER };

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      config: SessionConfig;
      profile: Profile;
      pack: Pack;
      messages: Message[];
      code?: string;
    };
    const pack = body.pack;
    if (!isValidPack(pack) || !body.profile) throw new ApiError(400, "Invalid report request.");
    const candidateTurns = (body.messages ?? []).filter((m) => m.role === "candidate").length;
    if (candidateTurns === 0) throw new ApiError(422, "No candidate answers to evaluate.");

    const interviewer = PERSONAS[body.config.persona].name;
    let transcript = transcriptText(body.messages, body.profile.name, interviewer);
    if (body.code?.trim()) transcript += `\n\n[FINAL CODE IN EDITOR]\n${body.code.slice(0, 6000)}`;

    const out = await generateJson<Scored>({
      model: MODELS.scoring,
      system: scoringSystem(pack, body.config, body.profile),
      turns: [{ role: "user", text: `TRANSCRIPT\n${transcript.slice(0, 40000)}` }],
      temperature: 0.2,
      schema: {
        type: Type.OBJECT,
        properties: {
          overall: num,
          verdict: { type: Type.STRING, enum: ["Strong Hire", "Hire", "Borderline", "Not Yet"] },
          summary: str,
          strengths: { type: Type.ARRAY, items: str },
          topFixes: { type: Type.ARRAY, items: str },
          dimensions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { name: str, score: num, evidence: str, feedback: str },
              required: ["name", "score", "evidence", "feedback"],
            },
          },
          answerReviews: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { question: str, answerSummary: str, score: num, feedback: str, betterAnswer: str, expectedAnswer: str },
              required: ["question", "answerSummary", "score", "feedback", "betterAnswer", "expectedAnswer"],
            },
          },
        },
        required: ["overall", "verdict", "summary", "strengths", "topFixes", "dimensions", "answerReviews"],
      },
    });

    out.overall = Math.max(0, Math.min(100, Math.round(out.overall)));
    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status });
  }
}
