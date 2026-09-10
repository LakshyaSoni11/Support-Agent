import { useState, useRef, useEffect } from "react";
import { getIntentInfo, type AgentResult } from "../intents";

interface Message {
  id: string;
  role: "customer" | "agent";
  text: string;
  result?: AgentResult;
  timestamp: string;
}

const SAMPLE_MESSAGES = [
  "My iPhone battery is draining so fast after the latest update, it barely lasts 3 hours now",
  "How do I reset my Apple ID password? I'm locked out",
  "My WiFi keeps disconnecting from my MacBook, any tips?",
  "I want a refund for an accidental App Store purchase",
  "iMessage keeps saying 'Not Delivered' when I try to send pictures",
  "My iPhone screen is cracked, how can I get it repaired?",
  "Why is my iPhone so slow after updating to iOS 17?",
];

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const stopRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const stopStreaming = () => {
    stopRef.current?.abort();
  };

  const processMessage = async (text: string) => {
    const controller = new AbortController();
    stopRef.current = controller;
    const customerMsg: Message = {
      id: `msg_${Date.now()}`,
      role: "customer",
      text,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, customerMsg]);
    setInput("");
    setLoading(true);

    const agentMsg: Message = {
      id: `agent_${Date.now()}`,
      role: "agent",
      text: "",
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, agentMsg]);

    try {
      const res = await fetch("/api/process-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, conversationId }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || "";

        for (const raw of events) {
          const evt = {
            event: "",
            data: "",
          };
          for (const line of raw.split(/\r?\n/)) {
            if (line.startsWith("event:")) evt.event = line.slice(6).trim();
            else if (line.startsWith("data:")) evt.data = line.slice(5).trim();
          }
          if (!evt.data) continue;

          const payload = JSON.parse(evt.data);
          if (evt.event === "meta") {
            setConversationId(payload.conversationId);
          } else if (evt.event === "reply") {
            const chunk = payload.chunk as string;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === agentMsg.id ? { ...m, text: m.text + chunk } : m
              )
            );
          } else if (evt.event === "done") {
            const result: AgentResult = {
              id: payload.id,
              customerText: payload.customerText,
              classification: payload.classification,
              draftReply: payload.draftReply,
              escalation: payload.escalation,
              conversationId: payload.conversationId,
              timestamp: payload.timestamp,
            };
            setConversationId(result.conversationId);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === agentMsg.id
                  ? { ...m, text: result.draftReply, result, timestamp: result.timestamp }
                  : m
              )
            );
          } else if (evt.event === "error") {
            throw new Error(payload.error || "Stream error");
          }
        }
      }
    } catch (err) {
      // Keep the partially-streamed reply when the user stops the response
      if ((err as Error)?.name !== "AbortError") {
        console.error("Failed to process message:", err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsg.id
              ? {
                  ...m,
                  text: "Sorry, I'm having trouble processing your request. Please try again.",
                }
              : m
          )
        );
      }
    } finally {
      setLoading(false);
      stopRef.current = null;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !loading) {
      processMessage(input.trim());
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-apple-gray">
            <div className="text-6xl mb-4">🍎</div>
            <h2 className="text-xl font-semibold text-apple-dark mb-2">
              Apple Support AI Agent
            </h2>
            <p className="text-sm mb-6 max-w-md">
              Try sending a customer support message to see the AI agent classify,
              draft a reply, and decide whether to escalate.
            </p>
            <div className="grid grid-cols-1 gap-2 max-w-lg w-full">
              {SAMPLE_MESSAGES.map((sample, i) => (
                <button
                  key={i}
                  onClick={() => processMessage(sample)}
                  className="text-left p-3 rounded-xl bg-white border border-gray-200 hover:border-apple-blue hover:shadow-sm transition-all text-sm text-apple-dark"
                >
                  {sample}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "customer" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                msg.role === "customer"
                  ? "bg-apple-blue text-white rounded-br-md"
                  : "bg-white text-apple-dark rounded-bl-md shadow-sm border border-gray-100"
              }`}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>

              {msg.result && (
                <ResultPanel result={msg.result} />
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-gray-100">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-apple-gray rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <div className="w-2 h-2 bg-apple-gray rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <div className="w-2 h-2 bg-apple-gray rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 bg-white border-t border-gray-200">
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && loading) {
                stopStreaming();
              }
            }}
            placeholder="Type a customer message..."
            className="flex-1 px-4 py-2.5 rounded-full bg-apple-lightgray border-none text-sm focus:outline-none focus:ring-2 focus:ring-apple-blue"
            disabled={loading}
          />
          {loading ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="px-5 py-2.5 bg-red-500 text-white rounded-full text-sm font-medium hover:bg-red-600 transition-colors"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-5 py-2.5 bg-apple-blue text-white rounded-full text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ResultPanel({ result }: { result: AgentResult }) {
  const [expanded, setExpanded] = useState(false);
  const intentInfo = getIntentInfo(result.classification.intent);

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-apple-blue hover:underline"
      >
        {expanded ? "Hide" : "Show"} agent analysis ▾
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 text-xs">
          {/* Intent */}
          <div className="flex items-center space-x-2">
            <span className="text-apple-gray">Intent:</span>
            <span className={`px-2 py-0.5 rounded-full font-medium ${intentInfo.color}`}>
              {intentInfo.icon} {intentInfo.label}
            </span>
            <span className="text-apple-gray">
              ({(result.classification.confidence * 100).toFixed(0)}%)
            </span>
          </div>
          <p className="text-apple-gray italic">{result.classification.reasoning}</p>

          {/* Escalation */}
          <div className="flex items-center space-x-2">
            <span className="text-apple-gray">Decision:</span>
            <span
              className={`px-2 py-0.5 rounded-full font-medium ${
                result.escalation.decision === "auto"
                  ? "bg-green-100 text-green-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {result.escalation.decision === "auto" ? "✅ Auto-handle" : "👤 Escalate"}
            </span>
          </div>
          <p className="text-apple-gray italic">{result.escalation.reason}</p>
        </div>
      )}
    </div>
  );
}
