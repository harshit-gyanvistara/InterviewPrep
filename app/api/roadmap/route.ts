import { NextResponse } from "next/server";
import { ApiError, MODELS, Type, generateJson } from "@/lib/gemini";
import type { Profile } from "@/lib/types";

interface ReportDigest {
  pack: string;
  overall: number;
  weakDimensions: string[];
  topFixes: string[];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { profile: Profile; weeks: number; digests: ReportDigest[] };
    if (!body.profile) throw new ApiError(400, "Missing profile.");
    const weeks = Math.min(12, Math.max(1, body.weeks || 4));

    const out = await generateJson<{ summary: string; items: { week: number; title: string; detail: string; focus: string }[] }>({
      model: MODELS.chat,
      system: `You are a career coach building a ${weeks}-week interview preparation roadmap. This may be for ANY profession — do not assume software/tech unless the role or job description says so.
Target role: ${body.profile.targetRole}. Target companies: ${body.profile.targetCompanies || "n/a"}. Experience: ${body.profile.experience}.
${body.profile.jobDescription?.trim() ? `Job description:\n"""\n${body.profile.jobDescription.slice(0, 4000)}\n"""` : ""}
Base it on the mock-interview results below (weak dimensions and fixes). If there are none, build a sensible baseline plan and recommend taking a baseline mock first.
Produce 2-4 concrete items per week (practice mocks to take, skills or topics to study, stories to write, portfolio/domain-specific prep). Be specific and realistic for THIS role. "focus" is a short label you choose to fit the role (e.g. Behavioural, Technical, Communication, Resume, Domain knowledge, Portfolio, Company research).`,
      turns: [{ role: "user", text: JSON.stringify(body.digests.slice(0, 15)) }],
      temperature: 0.5,
      schema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                week: { type: Type.NUMBER },
                title: { type: Type.STRING },
                detail: { type: Type.STRING },
                focus: { type: Type.STRING },
              },
              required: ["week", "title", "detail", "focus"],
            },
          },
        },
        required: ["summary", "items"],
      },
    });
    return NextResponse.json(out);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status });
  }
}
