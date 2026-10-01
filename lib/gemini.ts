import { GoogleGenAI, Type, type Schema } from "@google/genai";

// Server-only. The API key never reaches the browser.
export const MODELS = {
  chat: process.env.GEMINI_CHAT_MODEL || "gemini-3.8-flash",
  scoring: process.env.GEMINI_SCORING_MODEL || "gemini-pro-latest",
};

let client: GoogleGenAI | null = null;
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new ApiError(503, "GEMINI_API_KEY is not set. Add it to web/.env.local and restart the dev server.");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

/** Generate a JSON object that conforms to `schema`. */
export async function generateJson<T>(opts: {
  model: string;
  system: string;
  turns: ChatTurn[];
  schema: Schema;
  temperature?: number;
}): Promise<T> {
  const ai = getClient();
  try {
    const res = await ai.models.generateContent({
      model: opts.model,
      contents: opts.turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] })),
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseSchema: opts.schema,
        temperature: opts.temperature ?? 0.7,
      },
    });
    const text = res.text;
    if (!text) throw new ApiError(502, "Gemini returned an empty response.");
    return JSON.parse(text) as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiError(502, `Gemini request failed (${opts.model}): ${msg}`);
  }
}

export { Type };
