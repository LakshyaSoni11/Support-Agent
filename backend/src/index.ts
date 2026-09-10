import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";
import { classifyIntent, classifyIntentFallback } from "./lib/classify";
import { decideEscalation, decideEscalationFallback } from "./lib/escalation";
import { draftReply, draftReplyStream } from "./lib/reply";
import { INTENTS, type AgentResponse } from "./lib/intents";

const app = express();
app.set("trust proxy", 1);
app.use(cors({
  origin: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((s: string) => s.trim())
    : ["http://localhost:5173"],
  credentials: true,
}));
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Interactive calls should fail fast and fall back to keyword mode rather than
// hanging the chat for a minute while retrying rate-limited LLM calls.
const LLM_RETRY_OPTS = { maxRetries: 3, maxDelayMs: 10000 } as const;

// In-memory conversation store
const conversations: Map<string, AgentResponse[]> = new Map();

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", intents: Object.keys(INTENTS) });
});

// Get available intents
app.get("/api/intents", (_req, res) => {
  res.json(INTENTS);
});

// Process a single customer message
app.post("/api/classify", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    const useLLM = !!process.env.GROQ_API_KEY;
    const classification = useLLM
      ? await classifyIntent(text)
      : classifyIntentFallback(text);

    res.json(classification);
  } catch (error) {
    console.error("Classification endpoint error:", error);
    res.status(500).json({ error: "Classification failed" });
  }
});

// Full pipeline: classify + draft + escalate
app.post("/api/process", async (req, res) => {
  try {
    const { text, conversationId } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    const useLLM = !!process.env.GROQ_API_KEY;

    // Step 1: Classify intent
    const classification = useLLM
      ? await classifyIntent(text)
      : classifyIntentFallback(text);

    // Step 2: Decide escalation
    const escalation = useLLM
      ? await decideEscalation(text, classification.intent, classification.confidence)
      : decideEscalationFallback(classification.intent, classification.confidence);

    // Step 3: Draft reply
    const draftReplyText = await draftReply(text, classification.intent, escalation.decision);

    const response: AgentResponse = {
      id: uuidv4(),
      customerText: text,
      classification,
      draftReply: draftReplyText,
      escalation,
      timestamp: new Date().toISOString(),
    };

    // Store in conversation
    const convId = conversationId || uuidv4();
    const existing = conversations.get(convId) || [];
    existing.push(response);
    conversations.set(convId, existing);

    res.json({ ...response, conversationId: convId });
  } catch (error) {
    console.error("Process endpoint error:", error);
    res.status(500).json({ error: "Processing failed" });
  }
});

// Streaming pipeline: classify + escalate, then stream the drafted reply token-by-token
app.post("/api/process-stream", async (req, res) => {
  let aborted = false;
  res.on("close", () => {
    aborted = true;
  });

  try {
    const { text, conversationId } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    const useLLM = !!process.env.GROQ_API_KEY;
    const classification = useLLM
      ? await classifyIntent(text, LLM_RETRY_OPTS)
      : classifyIntentFallback(text);
    const escalation = useLLM
      ? await decideEscalation(text, classification.intent, classification.confidence, LLM_RETRY_OPTS)
      : decideEscalationFallback(classification.intent, classification.confidence, text);

    const id = uuidv4();
    const convId = conversationId || uuidv4();
    const timestamp = new Date().toISOString();

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const send = (event: string, data: unknown) => {
      if (aborted || res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send("meta", { id, conversationId: convId, classification, escalation, timestamp });

    let draftReplyText = "";
    await draftReplyStream(
      text,
      classification.intent,
      escalation.decision,
      (chunk) => {
        if (aborted) return;
        draftReplyText += chunk;
        send("reply", { chunk });
      },
      () => aborted,
      LLM_RETRY_OPTS
    );

    const storeConversation = () => {
      const response: AgentResponse = {
        id,
        customerText: text,
        classification,
        draftReply: draftReplyText,
        escalation,
        timestamp,
      };
      const existing = conversations.get(convId) || [];
      existing.push(response);
      conversations.set(convId, existing);
    };

    if (aborted) {
      storeConversation();
      res.end();
      return;
    }

    send("done", {
      id,
      customerText: text,
      conversationId: convId,
      classification,
      escalation,
      draftReply: draftReplyText,
      timestamp,
    });
    res.end();

    storeConversation();
  } catch (error) {
    console.error("Process-stream endpoint error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Processing failed" });
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Processing failed" })}\n\n`);
      res.end();
    }
  }
});

// Get conversation history
app.get("/api/conversations/:id", (req, res) => {
  const history = conversations.get(req.params.id);
  if (!history) {
    return res.status(404).json({ error: "Conversation not found" });
  }
  res.json(history);
});

// Batch process for evaluation
app.post("/api/batch", async (req, res) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array required" });
    }

    const results = [];
    for (const msg of messages.slice(0, 50)) {
      const useLLM = !!process.env.GROQ_API_KEY;
      const classification = useLLM
        ? await classifyIntent(msg.text)
        : classifyIntentFallback(msg.text);

      const escalation = useLLM
        ? await decideEscalation(msg.text, classification.intent, classification.confidence)
        : decideEscalationFallback(classification.intent, classification.confidence, msg.text);

      const draftReplyText = await draftReply(msg.text, classification.intent, escalation.decision);

      results.push({
        id: msg.id || uuidv4(),
        customerText: msg.text,
        classification,
        draftReply: draftReplyText,
        escalation,
      });
    }

    res.json({ results, count: results.length });
  } catch (error) {
    console.error("Batch endpoint error:", error);
    res.status(500).json({ error: "Batch processing failed" });
  }
});

// Serve golden set examples
app.get("/api/examples", (_req, res) => {
  try {
    const dataPath = path.join(__dirname, "../../data/golden_set.json");
    const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: "Failed to load examples" });
  }
});

// Serve evaluation results if available
app.get("/api/eval-results", (_req, res) => {
  try {
    const resultsPath = path.join(__dirname, "../evaluation_results.json");
    if (fs.existsSync(resultsPath)) {
      const data = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
      res.json(data);
    } else {
      res.json(null);
    }
  } catch (error) {
    res.json(null);
  }
});

// Trigger evaluation from API
let evaluationInProgress = false;
const execAsync = promisify(exec);

app.post("/api/evaluate", async (_req, res) => {
  if (evaluationInProgress) {
    return res.status(409).json({ error: "Evaluation already in progress. Please wait for it to finish." });
  }

  evaluationInProgress = true;
  try {
    // Run the harness in a child process WITHOUT blocking the event loop, so
    // other endpoints (health, examples, chat) stay responsive while it runs.
    const { stdout } = await execAsync("npx tsx src/evaluate.ts", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf-8",
      timeout: 600000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const resultsPath = path.join(__dirname, "../evaluation_results.json");
    if (fs.existsSync(resultsPath)) {
      const data = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
      res.json(data);
    } else {
      res.json({ output: stdout });
    }
  } catch (error: any) {
    res.status(500).json({ error: "Evaluation failed", output: error?.stdout || error?.message });
  } finally {
    evaluationInProgress = false;
  }
});

app.listen(PORT, () => {
  console.log(`Apple Support AI Agent running on http://localhost:${PORT}`);
  console.log(`LLM mode: ${process.env.GROQ_API_KEY ? "Groq API (LLM)" : "Fallback (keyword-based)"}`);
  console.log(`Intents: ${Object.keys(INTENTS).length}`);
});
