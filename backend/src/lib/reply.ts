import Groq from "groq-sdk";
import { type IntentKey, INTENTS } from "./intents";
import { MODEL } from "./model";
import { withRetry, type RetryOptions } from "./retry";
import { findSimilarConversations } from "./retrieve";

let groq: Groq | null = null;

function getGroq(): Groq | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groq) groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groq;
}

const BRAND_VOICE = `You are an Apple Support agent on Twitter. Your tone is:
- Empathetic but professional
- Concise (Twitter-appropriate, under 280 characters when possible)
- Solution-oriented
- Use "we" for Apple (e.g., "we'd like to help")
- Never promise things you can't deliver
- Always offer next steps
- Use DMs for complex issues`;

export async function draftReply(
  customerText: string,
  intent: IntentKey,
  escalationDecision: "auto" | "escalate"
): Promise<string> {
  return draftReplyStream(customerText, intent, escalationDecision, () => {});
}

export async function draftReplyStream(
  customerText: string,
  intent: IntentKey,
  escalationDecision: "auto" | "escalate",
  onChunk: (chunk: string) => void,
  isCancelled?: () => boolean,
  retryOpts?: RetryOptions
): Promise<string> {
  const prompt = buildReplyPrompt(customerText, intent, escalationDecision);

  try {
    const client = getGroq();
    if (!client) {
      const fallback = generateFallbackReply(intent, escalationDecision);
      onChunk(fallback);
      return fallback;
    }
    const stream = await withRetry(() =>
      client.chat.completions.create({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4,
        max_tokens: 300,
        stream: true,
      }),
      retryOpts
    );

    let full = "";
    for await (const chunk of stream) {
      if (isCancelled?.()) break;
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        onChunk(delta);
      }
    }

    if (!full.trim()) {
      const fallback = generateFallbackReply(intent, escalationDecision);
      onChunk(fallback);
      return fallback;
    }
    return full;
  } catch (error) {
    console.error("Reply drafting error:", error);
    const fallback = generateFallbackReply(intent, escalationDecision);
    onChunk(fallback);
    return fallback;
  }
}

function buildReplyPrompt(
  customerText: string,
  intent: IntentKey,
  escalationDecision: "auto" | "escalate"
): string {
  const intentConfig = INTENTS[intent];

  const escalationNote =
    escalationDecision === "escalate"
      ? "\nSince this needs human attention, politely acknowledge the issue and invite them to DM or call for personalized help."
      : "\nTry to resolve their issue directly with clear, actionable steps.";

  const historical = findSimilarConversations(customerText, intent, 3);
  let historicalBlock = "";
  if (historical.length > 0) {
    const rendered = historical
      .map(
        (h, i) =>
          `Example ${i + 1} — customer said:\n"${h.customer_text.slice(0, 200)}"\nApple Support historically replied:\n"${h.brand_response.slice(0, 200)}"`
      )
      .join("\n\n");
    historicalBlock = `
Similar past conversations we resolved (use them as grounding for tone, steps, and links — but adapt to THIS message):
${rendered}`;
  }

  return `${BRAND_VOICE}
${historicalBlock}
Customer message: "${customerText}"
Detected intent: ${intentConfig.label}
Action: ${escalationDecision === "auto" ? "Auto-resolve" : "Escalate to human"}
${escalationNote}

Draft a helpful Apple Support reply. Keep it concise and Twitter-appropriate.
Reply with just the message text, no JSON:`;
}

function generateFallbackReply(intent: IntentKey, escalation: "auto" | "escalate"): string {
  if (escalation === "escalate") {
    return "We understand your concern and want to make sure we give you the best support. Please send us a DM so we can look into this further for you. We're here to help!";
  }

  const replies: Record<string, string> = {
    device_hardware: "Thanks for reaching out. For hardware concerns, we recommend trying a force restart first. If the issue persists, we'd like to help further - please DM us with your device model and iOS version.",
    software_update: "Thanks for reporting this. Try going to Settings > General > Software Update to check for the latest version. If issues persist after updating, let us know the specific behavior you're seeing.",
    connectivity: "For connectivity issues, try turning WiFi/Bluetooth off and on again, or restart your device. If that doesn't help, we'd like to troubleshoot further - DM us!",
    messaging: "Let's get your messaging working again. First, check that iMessage is enabled in Settings > Messages. A simple restart often helps. If not, DM us for more troubleshooting.",
    account_access: "Account security is important to us. For account-related issues, we need to verify your identity. Please DM us or visit iforgot.apple.com for Apple ID recovery.",
    billing_store: "We understand billing concerns. Please check your purchase history at reportaproblem.apple.com. If you need further help, DM us with the details.",
    device_repair: "For repair options, you can schedule a Genius Bar appointment at apple.com/retail or contact Apple Support. We'll make sure you get the right help.",
    general_howto: "Great question! You can find detailed guides at support.apple.com. Is there a specific feature you'd like help with? We're happy to walk you through it.",
    complaint_frustration: "We're sorry to hear about your experience. Your feedback is important to us. Please DM us so we can understand what happened and make things right.",
    other: "Thanks for reaching out to Apple Support. We're here to help! Could you tell us more about the issue you're experiencing so we can assist you better?",
  };

  return replies[intent] || replies.other;
}
