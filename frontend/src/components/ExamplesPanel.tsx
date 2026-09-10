import { useState } from "react";
import { getIntentInfo, API_URL, INTENTS } from "../intents";

interface EvalExample {
  id: string;
  customer_text: string;
  brand_response: string;
  intent: string;
  escalation: string;
  escalation_reason: string;
}

export default function ExamplesPanel() {
  const [examples, setExamples] = useState<EvalExample[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterIntent, setFilterIntent] = useState<string>("all");

  const loadExamples = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/examples`);
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(`Failed to load examples: ${data?.error || `HTTP ${res.status}`}`);
        return;
      }
      if (!Array.isArray(data)) {
        setError("The server returned an invalid response for the golden set.");
        return;
      }
      setExamples(data);
    } catch (err: any) {
      setError(`Could not reach the backend: ${err?.message || "network error"}`);
    } finally {
      setLoading(false);
    }
  };

  const filtered = filterIntent === "all"
    ? examples
    : examples.filter((e) => e.intent === filterIntent);

  return (
    <div className="h-full overflow-y-auto p-6 scrollbar-thin">
      <div className="max-w-5xl mx-auto">
        <h2 className="text-2xl font-bold text-apple-dark mb-2">Golden Set Explorer</h2>
        <p className="text-sm text-apple-gray mb-6">
          Browse the 200 hand-labelled evaluation examples.
        </p>

        <button
          onClick={loadExamples}
          disabled={loading}
          className="px-4 py-2 bg-apple-blue text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors mb-4"
        >
          {loading ? "Loading..." : "Load Examples"}
        </button>

        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            <span className="font-medium">Something went wrong:</span> {error}
          </div>
        )}

        {examples.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              <button
                onClick={() => setFilterIntent("all")}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filterIntent === "all"
                    ? "bg-apple-blue text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                All ({examples.length})
              </button>
              {Object.keys(INTENTS).map((intent) => {
                const info = getIntentInfo(intent);
                const count = examples.filter((e) => e.intent === intent).length;
                return (
                  <button
                    key={intent}
                    onClick={() => setFilterIntent(intent)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      filterIntent === intent
                        ? "bg-apple-blue text-white"
                        : `${info.color} hover:opacity-80`
                    }`}
                  >
                    {info.label} ({count})
                  </button>
                );
              })}
            </div>

            <div className="space-y-3">
              {filtered.map((ex) => {
                const info = getIntentInfo(ex.intent);
                return (
                  <div key={ex.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                    <div className="flex items-start justify-between mb-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${info.color}`}>
                        {info.label}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          ex.escalation === "auto"
                            ? "bg-green-100 text-green-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {ex.escalation === "auto" ? "Auto" : "Escalate"}
                      </span>
                    </div>
                    <p className="text-sm text-apple-dark mb-2">
                      <span className="font-medium">Customer:</span> {ex.customer_text}
                    </p>
                    <p className="text-sm text-apple-gray">
                      <span className="font-medium">Brand replied:</span> {ex.brand_response}
                    </p>
                    <p className="text-xs text-apple-gray mt-1 italic">
                      Reason: {ex.escalation_reason}
                    </p>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
