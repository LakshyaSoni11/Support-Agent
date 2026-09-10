import Groq from "groq-sdk";
import { INTENTS, type IntentKey, type EscalationDecision } from "./intents";
import { MODEL } from "./model";
import { withRetry, type RetryOptions } from "./retry";

let groq: Groq | null = null;

function getGroq(): Groq | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

export async function decideEscalation(
  text: string,
  intent: IntentKey,
  confidence: number,
  retryOpts?: RetryOptions
): Promise<EscalationDecision> {
  const intentConfig = INTENTS[intent];

  const prompt = `You are an escalation decision engine for Apple Support.

Given this customer message and its classified intent, decide whether to AUTO-HANDLE or ESCALATE to a human agent.

Customer message: "${text}"
Classified intent: ${intent} (${intentConfig.label})
Classification confidence: ${confidence}

Rules:
- ESCALATE if: account security issues, billing disputes/refunds, legal threats, extreme frustration, device repair/replacement requests, issues requiring personal data access, repeat complaints
- AUTO-HANDLE if: standard how-to questions, known software bugs with documented fixes, simple connectivity troubleshooting, general product questions, FAQ-type queries

Respond with JSON only:
{
  "decision": "auto" or "escalate",
  "reason": "<brief reason>",
  "confidence": <0.0-1.0>
}`;

  try {
    const client = getGroq();
    if (!client) return decideEscalationFallback(intent, confidence);
    const response = await withRetry(() =>
      client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 256,
        response_format: { type: "json_object" },
      }),
      retryOpts
    );

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    return {
      decision: parsed.decision === "escalate" ? "escalate" : "auto",
      reason: parsed.reason || "Standard processing",
      confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
    };
  } catch (error) {
    console.error("Escalation decision error:", error);
    return decideEscalationFallback(intent, confidence);
  }
}

export function decideEscalationFallback(
  intent: IntentKey,
  confidence: number,
  text?: string
): EscalationDecision {
  const intentConfig = INTENTS[intent];
  const textLower = (text || "").toLowerCase();

  // Rule-based escalation signals (deterministic)
  const highRiskTerms = [
    "lawyer", "sue", "class action", "angry", "furious", "unacceptable",
    "worst", "done with", "switching to", "samsung", "android",
    "never buying", "fraud", "stolen", "police", "refund", "chargeback",
  ];
  if (highRiskTerms.some((term) => textLower.includes(term))) {
    return {
      decision: "escalate",
      reason: "High-risk signals detected (legal threat, fraud, refund/chargeback, switching brands)",
      confidence: 0.9,
    };
  }

  // Intent-based rules
  switch (intent) {
    case "account_access":
      return {
        decision: "escalate",
        reason: "Account security issues require human verification",
        confidence: 0.85,
      };
    case "billing_store":
      return {
        decision: "escalate",
        reason: "Billing/refund issues require human agent review",
        confidence: 0.8,
      };
    case "device_repair":
      return {
        decision: "escalate",
        reason: "Physical repair/replacement requires in-store or shipping coordination",
        confidence: 0.8,
      };
    case "complaint_frustration":
      return {
        decision: "escalate",
        reason: "Customer frustration requires empathetic human handling",
        confidence: 0.7,
      };
    case "general_howto":
      return {
        decision: "auto",
        reason: "Standard how-to question can be answered from knowledge base",
        confidence: 0.9,
      };
    default:
      return {
        decision: "auto",
        reason: `${intentConfig.label} issue can be resolved with standard troubleshooting`,
        confidence: confidence * 0.8,
      };
  }
}
