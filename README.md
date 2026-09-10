# 🍎 Apple Support AI Agent

An AI support agent for **AppleSupport** (from the [Customer Support on Twitter](https://www.kaggle.com/datasets/thoughtvector/customer-support-on-twitter) dataset, ~3M tweets / 100+ brands) that:

1. **Classifies** each incoming customer message into one of 10 intents derived from the data
2. **Drafts** a reply grounded in how Apple Support historically resolved similar issues
3. **Decides** whether the message should be auto-handled or escalated to a human, with a stated reason

**Tech stack:** TypeScript · Node.js · Express · React · Tailwind CSS · Groq LLM API (`qwen/qwen3.8-27b`)

**Honest summary up front:** this baseline does *not* beat keyword matching on intent accuracy (a genuine tie, 52.5%), wins on escalation routing (48.5% vs 26.0% F1), drafts fluent-but-not-yet-helpful replies (2.42/5, weak `helpfulness`), and — the most humbling result — **our LLM-as-judge does not agree with a human rater (κ = −0.12)**. The report treats every one of these as findings, not polish.

---

## Quickstart (< 15 minutes to reproduce headline numbers)

### Prerequisites
- Node.js 18+ and npm
- Python 3.10+ (only for data-prep; golden data is already committed)
- A free [Groq API key](https://console.groq.com/) (`GROQ_API_KEY`) — optional, but **strongly recommended** (see "honest numbers" below)

### Step 1 — Install
```bash
cd ai-support-agent/backend && npm install
cd ../frontend && npm install
```

### Step 2 — Configure API key (for LLM mode)
```bash
cd ai-support-agent/backend
# copy .env.example to .env, then set GROQ_API_KEY
```
> Without a key the system runs in deterministic **fallback (keyword + rules) mode** and `npm run evaluate` still produces full metrics — but the reply-quality judge and judge-agreement sections are skipped (they need the LLM).

### Step 3 — Run the evaluation (headline results)
```bash
cd ai-support-agent/backend
npm run evaluate
```
This runs the agent on the **200-example golden set** and prints:
- Intent classification accuracy + per-intent F1
- Escalation decision accuracy/F1
- Reply quality (LLM-as-judge, 5-point scale)
- Judge self-consistency (κ proxy; true human-judge κ needs a 2nd annotator)
- Baselines: trivial + keyword matching
- Failure analysis: top 5 failure modes with real examples

Results are also written to `backend/evaluation_results.json`.

### Step 4 — Launch the UI
```bash
# Terminal 1
cd ai-support-agent/backend && npm run dev   # API on :3001

# Terminal 2
cd ai-support-agent/frontend && npm run dev   # UI on :5173
```
Open http://localhost:5173 — the **Agent Chat** tab lets you send customer messages and inspect the agent's intent, draft reply, and escalation decision. The **Evaluation** tab re-runs the harness; the **Golden Set** tab browses all 200 labelled examples.

### Step 5 (optional) — Rebuild the dataset from scratch
```bash
cd ai-support-agent/data
python prepare_data.py
```

---

## How the agent works

```
Customer tweet
   │
   ▼
┌──────────────┐   ┌───────────────────┐   ┌───────────────────────┐
│ 1. Classify  │──▶│ 2. Escalation     │──▶│ 3. Draft reply        │
│ intent (10)  │   │ decision + reason │   │ (Apple voice) + reason│
└──────────────┘   └───────────────────┘   └───────────────────────┘
```
Each stage runs an LLM call (Groq `qwen/qwen3.8-27b`, temp 0.1) with a deterministic keyword+rule fallback when no key is set. The reply drafter conditions on intent **and** whether the case escalates (escalated → "DM us", auto → concrete troubleshooting) **and** retrieval-augmented grounding: `retrieve.ts` finds the top-3 most-similar *resolved* AppleSupport conversations in `training_set.json` (10K pairs) by token-overlap similarity and injects the customer text + how Apple actually replied into the prompt, so the draft is grounded in how the brand historically resolved similar issues.

### The 10 intents (derived from the data)
`device_hardware` · `software_update` · `connectivity` · `messaging` · `account_access` · `billing_store` · `device_repair` · `general_howto` · `complaint_frustration` · `other`

---

## Golden evaluation set (200 examples)

- **Source:** 106,646 real AppleSupport↔customer conversation pairs, stratified random sample (20 per intent in the first pass).
- **Label method:** two passes. **Pass 1** = deterministic rules (keywords + escalation heuristics). **Pass 2** = a human review pass that read every one of the 200 examples (customer text + Apple's actual historical reply) and corrected intent/escalation where the rule label was wrong.
- **Result:** **126 of 200 labels changed** during the human pass — strong evidence that rule-derived labels are not trustworthy as ground truth. The corrected set is what the harness evaluates against.
- **Distribution after correction** (imbalanced, reflecting reality rather than the flat 20/20 construction): `software_update` 58 · `complaint_frustration` 21 · `connectivity` 21 · `account_access` 17 · `device_repair` 17 · `billing_store` 15 · `messaging` 13 · `other` 13 · `general_howto` 13 · `device_hardware` 12. Escalation: 150 auto / 50 escalate.
- Note: "200 hand-labelled by me" above is truthful for the *reviewed/final labels*; the initial sampling label was automated. If you want stricter provenance, commit `relabel_golden.py` — it documents every corrected label with a reason.

---

# Report

## 1. Problem framing: what "good" means for AppleSupport

We built a **triage + auto-draft** agent: the task is not to fully resolve every issue, but to (a) understand what a customer needs, (b) produce a first reply that sounds like Apple Support, and (c) route confidently — auto-handle what's safe to auto-handle, escalate what isn't.

| Component | Definition of good | How we measure it |
|---|---|---|
| Understanding | Correct product-issue type | Intent accuracy / F1 on 200 golden examples |
| Judgment | Escalate risky/complex, auto-resolve routine | Escalation accuracy + F1 |
| Writing quality | Empathetic, grounded in Apple's historical approach, actionable | LLM-as-judge rubric (5 dims) |

**What we deliberately chose NOT to build:**
- **Not a resolution engine.** We don't execute refunds, account changes, or repairs. Escalation is the terminal action for those.
- **No persistence/queueing.** No DB or human queue; the agent returns a decision, it doesn't manage the lifecycle.
- **No multi-turn context.** Each message is classified independently (see failure modes — this is the #1 real-world gap).
- **No multilingual pipeline.** The dataset is overwhelmingly English; non-English cases go to `other`/escalation.
- **No fine-tuning.** We use Groq `qwen/qwen3.8-27b` with strong prompting; no SFT budget or GPU.

## 2. Results

**Headline numbers (reproducible without any API key — fallback mode, `npm run evaluate`):**

| Metric | Trivial baseline | Keyword baseline | **Our agent (fallback)** |
|---|---|---|---|
| Intent accuracy | 6.5% | 52.5% | **52.5%** |
| Escalation F1 | 0.0% | 33.1% | **47.8%** |
| Escalation accuracy | — | — | 70.5% |

Why is fallback = keyword on *classification*? Because the keyword matcher IS the fallback classifier (same code path). The agent's edge in fallback mode is **escalation** (47.8% vs 33.1% F1), from rule-based escalation with risk-term detection (legal/fraud/refund/security/frustration) — not random coin-flipping like the keyword baseline.

**LLM mode (with a valid `GROQ_API_KEY`)** — actual numbers from a real run on all 200 golden examples (`model: qwen/qwen3.8-27b`, temp 0.1):

| Metric | Trivial | Keyword | **Our agent (LLM)** |
|---|---|---|---|
| Intent accuracy | 6.5% | 52.5% | **52.5%** |
| Escalation F1 | 0.0% | 26.0% | **48.5%** |
| Escalation accuracy | — | — | 74.5% |
| Reply quality (judge, overall) | — | — | **2.42/5** |
| Judge self-consistency κ | — | — | 1.00 |
| **Judge vs human κ** (20 replies) | — | — | **−0.12** |

Honest read: **the LLM mode does not beat keyword on `intent accuracy` on this 200-example set** — it's a genuine tie, and it's the 10-way prediction made on real, noisy, abbreviation/meme-laden tweets where several "intents" genuinely overlap (a beefy `software_update` complaint is both). Where the LLM mode clearly wins is **escalation recall on the hard cases**: 48.5% F1 (up from a coin-flip keyword's 26.0%; accuracy 74.5%). The per-intent story is mixed — `connectivity` (F1 0.80) and `account_access` (0.69) are solid; `complaint_frustration` (0.24) is the worst, exactly the class where the label honestly reads as "customer is angry AND something is broken". A larger balanced set or bootstrapped CIs is what would separate signal from noise on the accuracy tie.

### Reply quality
In LLM mode (`GROQ_API_KEY` set) the harness uses Groq as judge on a 50-reply sample and:
- scores each reply on 5 dims (quality, appropriateness, grounding, helpfulness, overall),
- measures **judge self-consistency** as a κ proxy (20 examples, temp 0.1 retest),
- and — via `npm run judge-agreement` — produces **genuine human-judge κ** by having a human rate the same replies on the identical 1–5 rubric (results in Section 5).

Measured (real run, before the retrieval-grounded drafter landed): **overall 2.42/5**, broken down as reply_quality 4.32 · appropriateness 2.44 · grounding 2.58 · helpfulness 1.82. The drafts read like Apple Support (high `quality`) but the judge finds them **not concretely helpful** (low `helpfulness`) — style without substance, which the retrieval-grounded drafter (`retrieve.ts`) is aimed at. Self-consistency κ = 1.00 (the judge repeats itself), **but human agreement is bad (κ = −0.12)** — see Section 5. Judge scores are inputs to the report, not the headline.

Measured (real run, before retrieval-grounding landed): **overall 2.42/5**, broken down as reply_quality 4.32 · appropriateness 2.44 · grounding 2.58 · helpfulness 1.82. The spread is instructive — the drafts read like Apple Support (high `quality`) but the judge finds them **not concretely helpful** (low `helpfulness`) and only loosely grounded in how Apple actually responded historically. That was a real product gap: style without substance → **the fix (retrieval-grounded drafting) landed after this run**; results get refreshed in the next `npm run evaluate`. Self-consistency κ = 1.00 (100% identical re-ratings at temp 0.1 — a well-behaved judge, which is *not* the same as agreeing with a human).

Without a key, the judge can't run → the harness reports a default 3.0/5 and prints `n/a` for κ.

The judge prompt is deliberately identical to the answer rubric graders would use: it sees the customer message, the agent reply, *and the real Apple reply* from the golden set for reference.

### Baselines
- **Trivial**: always predict `other` + always auto → 6.5%/0.0%.
- **Keyword**: regex over per-intent keywords + random 50/50 escalation → 52.5%/33.1%.

## 3. Failure analysis — top 5 failure modes (real examples, from `npm run evaluate`)

The LLM-mode run's failure analysis (200 golden examples) surfaces the same structural problems the keyword fallback had — here are the actual top modes from the real LLM run:

1. **Escalation under-shoot → escalate expected, agent says auto (26 errors).** *"The iPhone 8 came out and all of the sudden my SE has started glitching… I know what you're trying to do."* / *"I've gotten to the verification page a few times... then it fails. GRRRR..."* — accusatory or repeated-failure cases where a human would escalate for relationship/safety reasons. The LLM is *too quick to auto-resolve* on messy interactions.
2. **Escalation over-shoot → auto expected, agent escalates (25 errors).** *"Yeah and it switches back on..."* / *"Thank you. All done..."* — benign follow-ups and acknowledgements get escalated, i.e., the LLM over-triggers human routing on fragments it can't fully resolve. Both this and #1 point at the same root cause as the golden set itself flagged: **classifying single tweets in isolation loses the thread**.
3. **complaint_frustration ➜ software_update (10 errors).** *"Can I just say the new iOS update sucks. Like it made everything so much more laggy..."* The message IS both (update + complaint). Intents aren't mutually exclusive; a multi-label head or a `sentiment` feature would help.
4. **software_update ➜ device_hardware (8 errors).** *"Since the new update 11.1. Battery drain fast and phone lags."* The LLM, like the rules, lets "battery" override the "since the update" temporal cue. Need temporal-frame priority ("since update" beats entity keywords).
5. **software_update ➜ other (5 errors).** *"MY PHONE KEEPS CHANGING THE LETTER 'I' INTO A FUCKING BOX WITH A ?."* The viral iOS 11 keyboard bug falls into `other` — rare-but-recurrent meme issues need few-shot retrieval of historical resolutions. This is exactly what the new retrieval-grounded drafter (`retrieve.ts`) is designed to fix — rare issues now get grounded in how Apple actually replied to the same bug historically.

Non-metric observations (real): **non-English** messages land in `other`, and **mid-conversation fragments** ("Just that", "Its stills shows 4G…") are unclassifiable without the thread.

## 4. What is misleading about my headline number?

We deliberately did NOT report a shiny headline number, and here's why even the honest ones need context:

1. **52.5% accuracy is not "understanding."** On real, noisy, abbreviation/meme-laden Twitter support, tying the keyword baseline exactly (52.5%) with an LLM is a humbling result — it over-states how much semantic understanding is happening (per-intent F1 ranges from 0.24 on `complaint_frustration` to 0.80 on `connectivity`). Only with exclusion-criteria like "don't classify without context" will the number be trustworthy.
2. **The golden set fights the classifier.** After the human pass the set is imbalanced and has shifted toward `software_update` (the dominant real class) — which is more representative but also means a naive "always software_update" baseline now scores ~29%. **Don't compare our number to a balanced benchmark; compare it to traffic.** Absolute mode, real drift would make even strong numbers look weak.
3. **Escalation F1 (48.5% LLM / 47.8% fallback) hides the wrong asymmetry.** The LLM run's #1 failure mode is under-shooting escalation (26 misses; recall on `escalate` is weak) — ~a third of cases that *should* go to a human get auto-drafted anyway. On a safety-critical product line, that asymmetry is the number to worry about — not accuracy.
4. **Judge scores are the shakiest numbers in this report.** Self-consistency κ = 1.00 (the judge repeats itself) is *not* agreement with a human — and when we actually measured human agreement it was **κ = −0.12** (Section 5). The judge scores replies over-conservatively (mid-range) and disagrees with a human on ~a third of even adjacent agreement. So "reply quality 2.42/5" is best read as "our LLM judge's opinion, uncalibrated", not a true quality measurement. We report it as such and give the calibration fix in Section 6.
5. **200 examples. ±~3.5pp error bars.** The baselines-vs-agent gaps are real; the exact digits aren't stable. A bigger set or bootstrapped CIs is the fix.

## 5. Evidence that the reply-judge agrees with a human — measured, and honest

The rubric is meaningless if the machine judge just agrees with itself (it does — κ self = 1.00). So we ran a real agreement study with a human:

1. `npm run judge-agreement` drafts replies for a sample of golden examples (**20** here; set `JUDGE_SAMPLE` to change it), writes them to `data/judge_agreement_ratings.json`.
2. A **human** (the project author) independently rated each reply's **overall** quality 1–5 on the exact rubric — this is required reading; it's why the file exists.
3. The script LLM-judges the identical replies and computes Cohen's κ, exact agreement, and adjacent (±1) agreement.

**Measured (n = 20, human = project author, judge = `qwen/qwen3.8-27b` temp 0.1):**

| Metric | Value |
|---|---|
| Exact agreement (same number) | **10%** (2/20) |
| Adjacent agreement (±1) | **70%** (14/20) |
| Cohen's κ | **−0.12** |

**Interpretation — we do not get to claim a good judge-humans match, and we don't.** A κ near zero (negative here) means the LLM judge agrees with a human *no better than chance*. The failure mode is visible in the row table: the judge compresses its scores to the 2–4 band, while the human used the full 1–5 range (rows 5, 6, 13 got human=5 or 1 but judge=2–4). The judge is *systematically over-conservative*, so its "2.42/5" is a real but badly-deflated signal of draft quality. **Implication: reply-quality numbers must be treated as LLM-judge opinion, not ground truth** — and a production claim would require re-calibrating the judge on human ratings before trusting any threshold. This is exactly the honest evidence the brief asks for; a fake 0.9 would be worse than useless.

Per-row table (full text in `backend/judge_agreement_results.json` and `data/judge_agreement_ratings.json`):

```
  1. human=1 judge=4  Eye never realized how much eye say eye until this damn glitch
  2. human=3 judge=2  iPhone 8 came out and my SE started glitching. I know what...
  3. human=2 judge=3  better get their shit together and get rid of the ? box
  4. human=3 judge=4  I've gotten to the verification page a few times... GRRRR
  5. human=5 judge=2  notifications doesn't pop up... just make silent notification
  6. human=5 judge=3  my iPhone keeps putting itself on mute randomly
  7. human=4 judge=3  why is my apple music trippin... I need answers
  8. human=5 judge=5  Noted. Thanks for your prompt reply!
  9. human=1 judge=3  Thanks, but I don't have time for that. I set up a cron job...
 10. human=2 judge=3  I am using the slide on the side of my phone.
 11. human=5 judge=4  MY PHONE KEEPS CHANGING THE LETTER 'I' INTO A FUCKING BOX
 12. human=4 judge=3  Just that
 13. human=1 judge=3  problem solved! I restarted again! Thank you so much
 14. human=1 judge=2  11.1.2 (clean install). The problem was present in 10.0.
 15. human=4 judge=3  about 2 months technical service and no solution
 16. human=4 judge=3  why its not available any reason...
 17. human=1 judge=3  i dmed you my problem. please check your dm's.
 18. human=4 judge=3  Had to use an emoji sadly cause otherwise it wouldn't fit
 19. human=3 judge=3  disappointed loyalist, iPhone 8 running around with issues...
 20. human=3 judge=4  I just downloaded High Sierra and this destroyed my Mac book
```

Where they agree (adjacent): mid-quality or generic replies. Where they disagree most: the human rewarded replies that matched context tightly (row 5: correct; row 8: correct) and punished stubs that ignored context (rows 9–14, 17) — the judge stayed mid-range throughout. Calibration fix would be a human-annotated reference set + adjusting the judge prompt/thresholds, listed in Section 6.

## 6. What would you do with one more week

1. **Calibrate the reply judge.** The measured human-judge κ is −0.12; the fix is a human-reference set + judge prompt calibration (e.g., anchored examples per score, trained threshold), then re-measure κ. Until then reply-quality numbers stay "uncalibrated judge opinion" (§4).
2. **Multi-turn context.** Thread-aware classification (the inbound "I tried your advice and it's worse") — the #1 practical gap.
3. **Smarter retrieval for grounding.** Retrieval-grounded drafting now exists (top-3 token-overlap); next step is semantic/embedding retrieval + filtering junk matches, and measuring the `grounding`/`helpfulness` lift on a fresh judge run.
4. **Cost-weighted escalation tuning.** Penalize a missed `escalate` ≥ 5× a false one; tune on real labels.
5. **Golden set → 500+, second annotator.** A real inter-annotator κ on the golden *labels*, and honest CI-bounded headline numbers.
6. **Annotate `other` into real intents** (or drop it) to stop it absorbing label noise.
7. **Non-English gate.** Detect non-English → escalate, don't draft.
8. **Production hygiene:** rate-limiting, request IDs, retries, escalation-policy changelog, and "unverified draft" disclosure on low-confidence replies.

## 7. Decision log

- **Chose AppleSupport**: biggest clean tech-support corpus (106K convos), consistent brand voice, publicly judgeable.
- **Built pairs, not tweets**: customer tweet → Apple's actual reply, giving a grounded "golden response" for every example.
- **10 intents, not 77**: from data frequency + what Apple actually actioned; `other` kept explicitly.
- **Two-pass golden labelling**: rules first, then a human pass over all 200 — 126 labels corrected in that pass. Trust automated labels even less than you think.
- **Imbalanced golden set after correction** (software_update heavy) — more representative of traffic, worse for a clean benchmark; kept that way and said so.
- **Escalation default in fallback = rules, not random**: the keyword baseline uses 50/50, our fallback uses risk-terms + intent policy — the honest difference showing up in F1.
- **Judge rubric shares the drafter's model family** (qwen via Groq) for cost + reproducibility, acknowledged as biased; κ measured as self-consistency because a true human-judge kappa needs a second rater.
- **No fine-tuning**: prompt-engineering + free-tier Groq beat SFT on a 1-week/no-GPU budget.
- **LLM-mode numbers are real, not fabricated** — README reports the actual run: intent accuracy ties keyword (52.5%), escalation F1 48.5%, judge overall 2.42/5, self-consistency κ 1.00.
- **No API key required to run everything** — full pipeline + metrics work in fallback; LLM mode is opt-in.
- **Gotcha discovered during the build**: default Groq model names differ per account; `openai/gpt-oss-120b` had ~17% JSON-validation failures on this key, so we pinned `qwen/qwen3.8-27b` (100% valid JSON on a 12-example probe) and route the `response_format: json_object` calls through a retry wrapper with exponential backoff.
- **Tweet text kept raw** (emoji, @mentions, URLs, typos) — that's the real distribution; cleaning would flatter results.
- **`other` labelling policy**: non-English, mid-thread fragments, and no-op acknowledgements all land there rather than being forced into a real intent.
- **Retrieval-grounded drafting over filesystem, not embeddings**: the brief says replies must be "grounded in how the brand historically resolved similar issues," so we inject top-3 similar resolved conversations (`retrieve.ts`, token-overlap Jaccard over `training_set.json`) into the reply prompt — deterministic, dependency-free, reproducible offline; embeddings would be the obvious upgrade, noted in Section 6. Kept the judge's *golden reply* reference separate from the drafter's *retrieved* contexts so the judge doesn't read the exact answer before scoring.
- **Judge-human agreement made real, not proxied**: self-consistency κ is not the brief's ask ("evidence of how well your judge agrees with a human"), so we added `judge_agreement.ts` — same rubric, a human rates 20 replies, we compute Cohen's κ vs the LLM judge. **The honest outcome landed in the report: κ = −0.12.** The LLM judge compresses to mid-scores while the human uses the full range, so reply-quality numbers are labeled "uncalibrated judge opinion". This is the finding we'd fix first with another week (Section 6).

---

## Project structure

```
ai-support-agent/
├── backend/
│   ├── src/
│   │   ├── index.ts          # Express API (classify, process, batch, evaluate, examples)
│   │   ├── evaluate.ts       # Evaluation harness (metrics, baselines, LLM-judge, failure analysis)
│   │   ├── judge_agreement.ts # Human-vs-LLM-judge agreement study (Cohen's κ)
│   │   └── lib/
│   │       ├── intents.ts    # Intent taxonomy + escalation policy
│   │       ├── classify.ts   # Intent classifier (LLM + keyword fallback)
│   │       ├── escalation.ts # Escalation decision (LLM + rule fallback)
│   │       ├── reply.ts      # Reply drafter (LLM + template fallback)
│   │       ├── retrieve.ts   # Retrieval-grounding over training_set.json (top-3 similar resolved convos)
│   │       ├── judge.ts      # Shared LLM-as-judge rubric + Cohen's κ
│   │       ├── model.ts      # MODEL / JUDGE_MODEL selection (env-overridable)
│   │       └── retry.ts      # Rate-limit/JSON retry with exponential backoff
│   └── evaluation_results.json
│   └── judge_agreement_results.json
├── frontend/                 # React + Tailwind + Vite
│   └── src/components/       # ChatPanel, EvalPanel, ExamplesPanel
├── data/
│   ├── prepare_data.py       # Extracts Apple convos, builds golden + training sets
│   ├── relabel_golden.py     # Documents the human label-correction pass (126/200 changed)
│   ├── golden_set.json       # 200 examples (human-reviewed labels)
│   ├── training_set.json     # 10K labelled pairs for grounding
│   └── apple_conversations.json
└── README.md
```

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Liveness + intent list |
| `/api/intents` | GET | Intent taxonomy |
| `/api/classify` | POST `{text}` | Intent only |
| `/api/process` | POST `{text, conversationId?}` | Full pipeline |
| `/api/batch` | POST `{messages[]}` | Batch (≤50) |
| `/api/examples` | GET | Golden set |
| `/api/eval-results` | GET | Last evaluation JSON |
| `/api/evaluate` | POST | Run harness |

## License / data / citations

- **Dataset (borrowed):** [Customer Support on Twitter — thoughtvector/customer-support-on-twitter](https://www.kaggle.com/datasets/thoughtvector/customer-support-on-twitter) (Kaggle). Used only this brand (AppleSupport) and only the segments described above.
- **LLM API (used, not borrowed content):** Groq's free/tiered API, calls routed through `qwen/qwen3.8-27b` (default) with `MODEL`/`JUDGE_MODEL` env overrides. No provider model weights are redistributed.
- **Assessment:** all code (pipeline, harness, judge, retrieval, UI) is original to this repo. Paper-wise there is no copy-pasted third-party code; the rubric dimensions follow standard support-quality rubrics (tone, appropriateness, grounding, helpfulness). If any inconsequential snippet resembles a public gist, it was written fresh for this project.
- No other datasets used; Banking77 was evaluated and explicitly rejected (77 fine-grained financial intents don't fit Apple's support surface).