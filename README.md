# Apple Support AI Agent

A support agent for AppleSupport built on the [Customer Support on Twitter](https://www.kaggle.com/datasets/thoughtvector/customer-support-on-twitter) dataset. For each customer message it (1) classifies intent, (2) drafts a reply grounded in how Apple historically replied to similar issues, and (3) decides auto-handle vs. escalate, with a reason.

**Stack:** TypeScript, Node/Express, React, Tailwind, Groq LLM (`qwen/qwen3.8-27b`).

**The short version:** it ties keyword matching on intent accuracy (52.5%), does better on escalation routing (48.5% vs 26.0% F1), and writes fluent but not-yet-helpful replies (judge 2.42/5). And our LLM-as-judge does not agree with a human rater (κ = −0.12). Those are findings, not polish.

---

## Reproduce the headline numbers (< 15 min)

Requires Node 18+. A Groq key is optional; without one everything still runs in keyword/rule fallback mode.

```bash
cd backend && npm install
cd ../frontend && npm install   # optional, for the UI
cd ../backend
cp .env.example .env            # add GROQ_API_KEY (optional)
npm run evaluate
```

`npm run evaluate` runs the agent on the 200-example golden set and prints intent accuracy + per-intent F1, escalation accuracy/F1, baselines, top-5 failure modes, and (with a key) reply quality scored by an LLM judge. Results also go to `backend/evaluation_results.json`.

For the UI:

```bash
cd backend && npm run dev     # API on :3001
cd ../frontend && npm run dev # UI on :5173
```

## How it works

Each stage is an LLM call with a deterministic fallback when no key is set. The reply drafter conditions on intent, on whether the case escalates, and on retrieval: `retrieve.ts` finds the 3 most-similar resolved AppleSupport conversations in `training_set.json` (10K pairs) and injects them into the prompt, so replies are grounded in how the brand actually handled similar cases.

The 10 intents (`src/lib/intents.ts`): `device_hardware`, `software_update`, `connectivity`, `messaging`, `account_access`, `billing_store`, `device_repair`, `general_howto`, `complaint_frustration`, `other`.

## Golden evaluation set (200)

Sampled from 106,646 real AppleSupport conversation pairs (stratified, 20 per intent first pass). Labelled in two passes: rule-based first, then a manual review of every example that corrected 126 of 200 labels. Distribution after correction skews to `software_update` (58) since that's real traffic; escalation is 150 auto / 50 escalate. `data/relabel_golden.py` documents every corrected label.

## Results

| Metric | Trivial | Keyword | Agent (LLM) |
|---|---|---|---|
| Intent accuracy | 6.5% | 52.5% | 52.5% |
| Escalation F1 | 0.0% | 26.0% | 48.5% |
| Escalation accuracy | — | — | 74.5% |
| Reply quality (judge, overall) | — | — | 2.42/5 |

Fallback mode (no key) is the same on classification since the keyword matcher is the fallback classifier; it wins on escalation (47.8% vs 33.1% F1) via rule-based risk detection (legal/fraud/refund/security/frustration) rather than the keyword baseline's coin flip.

The LLM does not beat the keyword baseline on intent on this set. Several intents genuinely overlap (a software-update complaint is both), so the tie masks real per-intent spread: `connectivity` F1 0.80 and `account_access` 0.69 are solid; `complaint_frustration` 0.24 is worst. The wins are in escalation recall on hard cases.

### Reply quality and the judge

With a key, a 50-reply sample is scored on five 1–5 dims (quality, appropriateness, grounding, helpfulness, overall). Measured: overall 2.42, split 4.32 / 2.44 / 2.58 / 1.82. The drafts read like Apple Support but aren't concretely helpful. The retrieval-grounded drafter landed after this run, so the next `npm run evaluate` will refresh these numbers.

The judge is the shakiest number in the report. Self-consistency is perfect (κ = 1.00) because the judge repeats itself at temp 0.1, which is not the same as being right. `backend/judge_agreement_results.json` holds a real human-judge agreement study on 20 replies (same rubric): exact agreement 10%, adjacent 70%, Cohen's κ −0.12. The judge compresses scores to the 2–4 band while the human used 1–5. Until it's recalibrated on human ratings, reply-quality scores are uncalibrated judge opinion.

## Failure analysis (top 5, from the LLM run)

1. **Escalate expected, agent says auto (26).** Accusatory or repeated-failure messages ("...then it fails. GRRRR") get auto-resolved when a human would escalate for relationship/safety reasons.
2. **Auto expected, agent escalates (25).** Benign fragments ("Yeah and it switches back on", "Thank you. All done") get escalated. Both this and #1 stem from classifying single tweets without thread context.
3. **complaint_frustration as software_update (10).** "The new iOS update sucks... laggy" is genuinely both; intents aren't mutually exclusive.
4. **software_update as device_hardware (8).** "Since new update 11.1. Battery drain fast" lets the entity keyword override the temporal cue.
5. **software_update as other (5).** The viral iOS 11 "letter I becomes a box" bug lands in `other`; rare meme issues need retrieval of historical resolutions, which the drafter now does.

Non-English messages and mid-thread fragments ("Just that") land in `other` and are unclassifiable without context.

## What's misleading about the headline?

- **52.5% is not understanding.** Tying keyword matching on noisy, meme-laden tweets overstates real semantic ability; per-intent F1 spans 0.24–0.80.
- **The golden set fights the classifier.** After the human pass it's imbalanced toward `software_update` (the real dominant class), so an "always software_update" baseline already scores ~29%. Compare against traffic, not a balanced benchmark.
- **Escalation F1 hides the asymmetry.** The #1 failure mode is under-escalation (26 misses) — roughly a third of cases that should reach a human get auto-drafted anyway. On a safety-critical product that asymmetry matters more than accuracy.
- **Judge scores are opinion, not measurement.** κ vs. human is −0.12 (see above).
- **200 examples → ±~3.5pp error bars.** The gaps are real; the exact digits aren't stable.

## Next week

1. Calibrate the reply judge on human ratings, then re-measure κ.
2. Thread-aware (multi-turn) classification; the #1 practical gap.
3. Embedding-based retrieval instead of token-overlap, and measure the grounding/helpfulness lift.
4. Cost-weighted escalation tuning (penalize missed escalates ≥5× false ones).
5. Bigger golden set, second annotator, real inter-annotator κ and CIs.
6. Annotate `other` into real intents, or drop it; add a non-English gate (escalate, don't draft).
7. Production hygiene: rate limits, request IDs, retries, disclosure on low-confidence drafts.

## Decisions (log)

- **AppleSupport**: largest clean tech-support corpus (106K convos), consistent brand voice.
- **Pairs, not tweets**: customer tweet → Apple's actual reply, giving a grounded golden response for every example.
- **10 intents, not 77**: from data frequency plus what Apple actually actioned; kept `other` explicitly.
- **Two-pass labelling**: rules then full manual review; 126/200 labels changed, so automated labels are not trustworthy as ground truth.
- **Kept the set imbalanced** after correction: more representative, worse as a clean benchmark; reported it as such.
- **Fallback escalation = rules, not random**: risk-terms + intent policy, unlike the keyword baseline's 50/50.
- **Judge shares the drafter's model family** for cost and reproducibility, acknowledged as biased; κ is self-consistency because a true human-judge κ needs a second rater.
- **No fine-tuning**: prompting + free-tier Groq beat SFT on a one-week, no-GPU budget.
- **Pinned `qwen/qwen3.8-27b`**: default Groq models differ per account and `gpt-oss-120b` had ~17% JSON-validation failures on this key; all `json_object` calls go through a retry wrapper.
- **Tweet text kept raw** (emojis, mentions, typos): cleaning would flatter results.
- **`other` policy**: non-English, mid-thread fragments, no-op acknowledgements go there rather than being forced into a real intent.
- **Filesystem retrieval, not embeddings**: top-3 Jaccard over `training_set.json`, deterministic and reproducible offline; the judge sees the golden reply for reference while the drafter sees only retrieved, not-identical, conversations.
- **Human agreement measured, not proxied**: `judge_agreement.ts` computes a real Cohen's κ vs. a human rater on 20 replies. Result: −0.12, reported honestly.

## Deployment (live, Railway + Vercel)

- **Backend (Railway)**: root dir `backend`; variables `GROQ_API_KEY` and `CORS_ORIGIN` (comma-separated frontend origins; default `http://localhost:5173`), both scoped to build time and runtime. Redeploy after any variable change.
- **Frontend (Vercel)**: root dir `frontend`; env `VITE_API_URL` = backend URL (empty → same origin).

## Project layout

```
backend/    Express API, eval harness, judge study (src/, railway.json, Procfile)
frontend/   React + Tailwind + Vite UI (Chat, Evaluation, Golden Set tabs)
data/       golden_set.json (200), training_set.json (10K), prepare/relabel scripts
```

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness + intents |
| `/api/intents` | GET | Intent taxonomy |
| `/api/classify` | POST `{text}` | Intent only |
| `/api/process` | POST `{text, conversationId?}` | Full pipeline |
| `/api/process-stream` | POST `{text, conversationId?}` | Full pipeline, reply streamed (SSE) |
| `/api/batch` | POST `{messages[]}` | Batch (≤50) |
| `/api/examples` | GET | Golden set |
| `/api/eval-results` | GET | Last evaluation JSON |
| `/api/evaluate` | POST | Run harness |

## Data and code provenance

- Dataset: [Customer Support on Twitter - thoughtvector](https://www.kaggle.com/datasets/thoughtvector/customer-support-on-twitter) (Kaggle). Only AppleSupport and the segments described here. Banking77 was evaluated and rejected: 77 fine-grained financial intents don't fit Apple's support surface.
- LLM calls: Groq's API via `qwen/qwen3.8-27b` (default), with `MODEL`/`JUDGE_MODEL` overrides. No provider weights are redistributed.
- All pipeline, harness, judge, retrieval, and UI code is original to this repo.
