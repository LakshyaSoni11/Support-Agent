import Groq from "groq-sdk";
import { withRetry } from "./retry";
import { JUDGE_MODEL } from "./model";

export interface JudgeRating {
  reply_quality: number;      // 1-5
  appropriateness: number;    // 1-5
  grounding: number;          // 1-5 (does it use brand voice/approach)
  helpfulness: number;        // 1-5
  overall: number;            // 1-5
  reasoning: string;
}

export async function judgeReplyQuality(
  customerText: string,
  agentReply: string,
  goldenReply: string,
  intent: string
): Promise<JudgeRating> {
  const prompt = `You are an expert evaluator for Apple Support customer service responses.

Rate the AI agent's reply on these dimensions (1-5 scale):

CUSTOMER MESSAGE: "${customerText}"
INTENT: ${intent}
AGENT REPLY: "${agentReply}"
HISTORICAL BRAND REPLY (for reference): "${goldenReply}"

Rate each dimension:
1. reply_quality (1-5): Grammar, clarity, professional tone
2. appropriateness (1-5): Is it appropriate for the context and intent?
3. grounding (1-5): Does it follow Apple Support's actual style (empathetic, solution-oriented, offers next steps)?
4. helpfulness (1-5): Would this actually help the customer?
5. overall (1-5): Overall quality combining all factors

Respond with JSON only:
{
  "reply_quality": <1-5>,
  "appropriateness": <1-5>,
  "grounding": <1-5>,
  "helpfulness": <1-5>,
  "overall": <1-5>,
  "reasoning": "<brief explanation>"
}`;

  if (!process.env.GROQ_API_KEY) {
    return {
      reply_quality: 3, appropriateness: 3, grounding: 3, helpfulness: 3, overall: 3,
      reasoning: "No GROQ_API_KEY available for judge",
    };
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  try {
    const response = await withRetry(() =>
      groq.chat.completions.create({
        model: JUDGE_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: "json_object" },
      })
    );

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      reply_quality: clamp(parsed.reply_quality),
      appropriateness: clamp(parsed.appropriateness),
      grounding: clamp(parsed.grounding),
      helpfulness: clamp(parsed.helpfulness),
      overall: clamp(parsed.overall),
      reasoning: parsed.reasoning || "No reasoning provided",
    };
  } catch (error) {
    console.error("Judge error:", error);
    return {
      reply_quality: 3,
      appropriateness: 3,
      grounding: 3,
      helpfulness: 3,
      overall: 3,
      reasoning: "Judge call failed, using default rating",
    };
  }
}

function clamp(v: unknown): number {
  const n = Math.round(Number(v) || 3);
  return Math.min(5, Math.max(1, n));
}

/**
 * Cohen's kappa for two raters on a 1-5 ordinal scale.
 * Returns raw agreement, kappa, and "adjacent" agreement (±1 tolerance)
 * which is the usual way support-quality rubrics are judged usable.
 */
export function cohensKappa(a: number[], b: number[]): {
  kappa: number;
  agreement: number;
  adjacentAgreement: number;
  n: number;
} {
  const n = a.length;
  if (n === 0 || n !== b.length) return { kappa: NaN, agreement: 0, adjacentAgreement: 0, n };

  // Observed agreement
  let po = 0;
  let adj = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) po++;
    if (Math.abs(a[i] - b[i]) <= 1) adj++;
  }
  po /= n;

  // Chance agreement from marginal distributions (5 categories: 1..5)
  const rows = new Array(6).fill(0);
  const cols = new Array(6).fill(0);
  for (let i = 0; i < n; i++) {
    rows[a[i] > 0 && a[i] < 6 ? a[i] : 1]++;
    cols[b[i] > 0 && b[i] < 6 ? b[i] : 1]++;
  }
  let pe = 0;
  for (let c = 1; c <= 5; c++) {
    pe += (rows[c] / n) * (cols[c] / n);
  }

  const kappa = pe === 1 ? NaN : (po - pe) / (1 - pe);
  return { kappa, agreement: po, adjacentAgreement: adj / n, n };
}