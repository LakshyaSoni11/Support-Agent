import Groq from "groq-sdk";
import { INTENTS, type IntentKey, type ClassificationResult } from "./intents";
import { MODEL } from "./model";
import { withRetry, type RetryOptions } from "./retry";

let groq: Groq | null = null;

function getGroq(): Groq | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

const INTENT_LIST = Object.entries(INTENTS)
  .map(([key, val]) => `- ${key}: ${val.description}`)
  .join("\n");

export async function classifyIntent(text: string, retryOpts?: RetryOptions): Promise<ClassificationResult> {
  const prompt = `You are an intent classifier for Apple Support customer messages on Twitter.

Classify the following customer message into exactly ONE of these intents:

${INTENT_LIST}

Customer message: "${text}"

Respond with JSON only:
{
  "intent": "<intent_key>",
  "confidence": <0.0-1.0>,
  "reasoning": "<one sentence explaining why>"
}`;

  try {
    const client = getGroq();
    if (!client) return classifyIntentFallback(text);
    const response = await withRetry(() =>
      client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
      retryOpts
    );

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    const intent = (parsed.intent as string) || "other";
    const validIntent = Object.keys(INTENTS).includes(intent) ? (intent as IntentKey) : "other";

    return {
      intent: validIntent,
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
      reasoning: parsed.reasoning || "Classified by LLM",
    };
  } catch (error) {
    console.error("Classification error:", error);
    return classifyIntentFallback(text);
  }
}

export function classifyIntentFallback(text: string): ClassificationResult {
  const textLower = text.toLowerCase();
  let bestIntent: IntentKey = "other";
  let bestScore = 0;

  for (const [key, config] of Object.entries(INTENTS)) {
    let score = 0;
    for (const kw of config.keywords) {
      if (textLower.includes(kw)) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = key as IntentKey;
    }
  }

  const confidence = bestScore > 0 ? Math.min(0.9, 0.4 + bestScore * 0.15) : 0.3;

  return {
    intent: bestIntent,
    confidence,
    reasoning: `Keyword-based fallback: matched ${bestScore} keywords for ${bestIntent}`,
  };
}
