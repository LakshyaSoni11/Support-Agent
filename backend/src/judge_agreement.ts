/**
 * Human-judge agreement evidence.
 *
 * Workflow (two runs):
 *   1) npx tsx src/judge_agreement.ts  → builds data/judge_agreement_ratings.json
 *      containing N agent replies + golden replies, with empty `human_overall`
 *      fields. A human then fills in `human_overall` (1-5) for each row.
 *   2) npx tsx src/judge_agreement.ts  → re-runs: now that `human_overall` is set,
 *      it LLM-judges the same replies and computes Cohen's kappa + agreement.
 *
 * The rubric is intentionally the SAME one the LLM judge uses (overall 1-5), so
 * the kappa measures judge-vs-human agreement on the exact dimension we report.
 */
import dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { classifyIntent, classifyIntentFallback } from "./lib/classify";
import { decideEscalation, decideEscalationFallback } from "./lib/escalation";
import { draftReply } from "./lib/reply";
import { judgeReplyQuality, cohensKappa } from "./lib/judge";

interface GoldenExample {
  id: string;
  customer_text: string;
  brand_response: string;
  intent: string;
  escalation: string;
  escalation_reason: string;
}

interface RatingRow {
  id: string;
  customer_text: string;
  golden_reply: string;
  agent_reply: string;
  intent: string;
  human_overall: number | null;
  judge_overall: number | null;
}

const SAMPLE_SIZE = parseInt(process.env.JUDGE_SAMPLE || "30", 10);
const RATINGS_PATH = path.join(__dirname, "../../data/judge_agreement_ratings.json");

async function run() {
  const golden: GoldenExample[] = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../data/golden_set.json"), "utf-8")
  );

  const sample = golden.slice(0, SAMPLE_SIZE);
  const useLLM = !!process.env.GROQ_API_KEY;
  console.log(`Human-judge agreement | sample=${sample.length} | LLM=${useLLM}`);

  let rows: RatingRow[];
  if (fs.existsSync(RATINGS_PATH)) {
    rows = JSON.parse(fs.readFileSync(RATINGS_PATH, "utf-8")) as RatingRow[];
    console.log(`Loaded existing ratings file (${rows.length} rows)`);
  } else {
    console.log("Building ratings file (human ratings still empty)...");
    rows = [];
    for (let i = 0; i < sample.length; i++) {
      const ex = sample[i];
      const classification = useLLM
        ? await classifyIntent(ex.customer_text)
        : classifyIntentFallback(ex.customer_text);
      const escalation = useLLM
        ? await decideEscalation(ex.customer_text, classification.intent, classification.confidence)
        : decideEscalationFallback(classification.intent, classification.confidence, ex.customer_text);
      const reply = await draftReply(ex.customer_text, classification.intent, escalation.decision);
      rows.push({
        id: ex.id,
        customer_text: ex.customer_text,
        golden_reply: ex.brand_response,
        agent_reply: reply,
        intent: ex.intent,
        human_overall: null,
        judge_overall: null,
      });
      fs.writeFileSync(RATINGS_PATH, JSON.stringify(rows, null, 2));
      if ((i + 1) % 5 === 0) console.log(`  drafted ${i + 1}/${sample.length}`);
    }
    fs.writeFileSync(RATINGS_PATH, JSON.stringify(rows, null, 2));
    console.log("Wrote ratings file: data/judge_agreement_ratings.json");
    console.log("Now a human must set human_overall (1-5) for each row, then re-run this script.");
    return;
  }

  // ---------- Second pass: human ratings present → LLM-judge + compute kappa ----------
  const missing = rows.filter((r) => r.human_overall == null).length;
  if (missing > 0) {
    console.log(`Still ${missing}/${rows.length} rows without human_overall. Please fill them first.`);
    return;
  }

  console.log("Running LLM judge on the same replies...");
  const pending = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.judge_overall == null);
  console.log(`  ${rows.length - pending.length}/${rows.length} already judged, ${pending.length} to do`);
  for (const { r, i } of pending) {
    const rating = await judgeReplyQuality(r.customer_text, r.agent_reply, r.golden_reply, r.intent);
    r.judge_overall = rating.overall;
    fs.writeFileSync(RATINGS_PATH, JSON.stringify(rows, null, 2));
    console.log(`  judged ${i + 1}/${rows.length}`);
  }

  const human = rows.map((r) => r.human_overall as number);
  const judge = rows.map((r) => r.judge_overall as number);

  const { kappa, agreement, adjacentAgreement, n } = cohensKappa(human, judge);

  console.log("-".repeat(60));
  console.log("HUMAN vs LLM-JUDGE AGREEMENT (overall, 1-5)");
  console.log("-".repeat(60));
  console.log(`n                     : ${n}`);
  console.log(`Exact agreement       : ${(agreement * 100).toFixed(1)}%`);
  console.log(`Adjacent (+-1) agreement: ${(adjacentAgreement * 100).toFixed(1)}%`);
  console.log(`Cohen's kappa         : ${kappa.toFixed(3)}`);

  console.log("\nPer-row table:");
  rows.forEach((r, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. human=${r.human_overall} judge=${r.judge_overall}  ${r.customer_text.slice(0, 60)}`
    );
  });

  fs.writeFileSync(RATINGS_PATH, JSON.stringify(rows, null, 2));
  const result = {
    n,
    agreement,
    adjacentAgreement,
    kappa,
    note: `Human rater: the project author. LLM judge: ${process.env.GROQ_JUDGE_MODEL || "default"}. Each rated overall (1-5) with the identical rubric.`,
  };
  fs.writeFileSync(
    path.join(__dirname, "../judge_agreement_results.json"),
    JSON.stringify(result, null, 2)
  );
  console.log("\nSaved judge_agreement_results.json");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});