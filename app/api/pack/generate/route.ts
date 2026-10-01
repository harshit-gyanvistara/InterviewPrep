import { NextResponse } from "next/server";
import { ApiError, MODELS, Type, generateJson } from "@/lib/gemini";
import { isTechnical } from "@/lib/packs";
import type { Profile } from "@/lib/types";

const str = { type: Type.STRING };

interface GeneratedPack {
  title: string;
  company: string;
  role: string;
  roundType: "behavioural" | "technical" | "hr" | "coding";
  description: string;
  durationMin: number;
  topics: string[];
  rubric: string[];
  style: string;
}

/**
 * Builds a small set of interview rounds tailored to the candidate's exact target role and
 * job description. This is what makes the app work for any profession: instead of a fixed
 * list of tech rounds, the rounds are derived from what the real job actually asks for.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { profile: Profile };
    const p = body.profile;
    if (!p?.targetRole?.trim()) throw new ApiError(400, "Missing target role.");
    const tech = isTechnical(p);

    const out = await generateJson<{ packs: GeneratedPack[] }>({
      model: MODELS.scoring,
      system: `You design realistic mock-interview rounds for job seekers preparing for a specific role. Work ONLY from the information given — never invent a company name if none is given, use "Any employer" instead.

TARGET ROLE: ${p.targetRole}
TARGET COMPANIES: ${p.targetCompanies || "not specified"}
EXPERIENCE LEVEL: ${p.experience}
${p.jobDescription?.trim() ? `JOB DESCRIPTION (use this as the primary source of what to ask about):\n"""\n${p.jobDescription.slice(0, 8000)}\n"""` : "No job description was provided — base the rounds on the target role alone, using well-known norms for that role and level."}
${p.resume?.trim() ? `CANDIDATE RESUME (for context only, do not grade it here):\n"""\n${p.resume.slice(0, 4000)}\n"""` : ""}

Produce 2-3 interview rounds that this candidate would realistically face for THIS role, covering different things (e.g. a screening/behavioural round plus one or two rounds that test the actual skills the job description asks for: technical, case-based, portfolio/design, sales pitch, clinical scenario, teaching demo, whatever fits the role — do not default to software questions unless the role is a software role).
${tech ? "This role looks technical/software-related, so it is fine to include a coding or CS-fundamentals-style round if the job description supports it." : "This role does NOT look like a software engineering role — do NOT invent a programming/DSA coding round unless the job description explicitly asks for coding."}

For each round give: title (specific to the role, not generic), company (use the target company if one was given, else "Any employer"), role (the exact target role), roundType (one of behavioural, technical, hr, coding — use "coding" only for genuine programming rounds), a one-sentence description, durationMin (10-30), 4-7 topics that are concrete and specific to this JD/role (not generic filler), 4-5 rubric dimension names appropriate to judging this exact round, and a one-sentence style instruction for how the interviewer should behave in this round.`,
      turns: [{ role: "user", text: "Generate the rounds now." }],
      temperature: 0.6,
      schema: {
        type: Type.OBJECT,
        properties: {
          packs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: str,
                company: str,
                role: str,
                roundType: { type: Type.STRING, enum: ["behavioural", "technical", "hr", "coding"] },
                description: str,
                durationMin: { type: Type.NUMBER },
                topics: { type: Type.ARRAY, items: str },
                rubric: { type: Type.ARRAY, items: str },
                style: str,
              },
              required: ["title", "company", "role", "roundType", "description", "durationMin", "topics", "rubric", "style"],
            },
          },
        },
        required: ["packs"],
      },
    });

    if (!out.packs?.length) throw new ApiError(502, "Could not generate interview rounds. Try again.");
    return NextResponse.json({ packs: out.packs.slice(0, 3) });
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status });
  }
}
