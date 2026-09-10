/**
 * Retrieve historically-resolved conversations similar to a customer message,
 * so the reply drafter can ground its answer in how Apple actually responded.
 *
 * Uses a tiny lexical scorer over data/training_set.json (10K resolved pairs) —
 * tokenized Jaccard similarity, with a same-intent bonus. Cheap (~10ms), no deps.
 */
import * as fs from "fs";
import * as path from "path";
import { type IntentKey } from "./intents";

export interface HistoricalExample {
  customer_text: string;
  brand_response: string;
  intent: string;
}

interface Indexed { text: string; brand_response: string; intent: string; tokens: Set<string> }

let index: Indexed[] | null = null;

const TOKEN_RE = /[a-z0-9]+/g;

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of text.toLowerCase().match(TOKEN_RE) || []) {
    if (match.length > 2) tokens.add(match);
  }
  return tokens;
}

function loadIndex(): Indexed[] {
  if (index) return index;
  try {
    const dataPath = path.join(__dirname, "../../../data/training_set.json");
    const data = JSON.parse(fs.readFileSync(dataPath, "utf-8")) as HistoricalExample[];
    index = data.map((d) => ({
      text: d.customer_text,
      brand_response: d.brand_response,
      intent: d.intent,
      tokens: tokenize(d.customer_text),
    }));
  } catch {
    index = [];
  }
  return index;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) {
    if (b.has(t)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function findSimilarConversations(
  customerText: string,
  intent: IntentKey,
  k = 3
): HistoricalExample[] {
  const idx = loadIndex();
  if (idx.length === 0) return [];

  const qTokens = tokenize(customerText);

  const scored = idx.map((candidate) => {
    const base = jaccard(qTokens, candidate.tokens);
    const intentBonus = candidate.intent === intent ? 0.15 : 0;
    // Subtle: a very short query shouldn't retrieve on a single shared word,
    // so only keep candidates that share >= 2 meaningful tokens.
    let overlap = 0;
    for (const t of qTokens) {
      if (candidate.tokens.has(t)) overlap++;
    }
    return { candidate, score: base + intentBonus, overlap };
  });

  const eligible = scored
    .filter((s) => s.overlap >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return eligible.map((s) => ({
    customer_text: s.candidate.text,
    brand_response: s.candidate.brand_response,
    intent: s.candidate.intent,
  }));
}