import { useState } from "react";
import { getIntentInfo, INTENTS } from "../intents";

interface EvalResult {
  classification: { accuracy: number; perIntent: Record<string, { precision: number; recall: number; f1: number }> };
  escalation: { accuracy: number; precision: number; recall: number; f1: number };
  replyQuality: { reply_quality: number; appropriateness: number; grounding: number; helpfulness: number; overall: number };
  baselines: any;
  agreement: { kappa: number; agreementRate: number };
  failureModes: any[];
}

export default function EvalPanel() {
  const [results, setResults] = useState<EvalResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runEvaluation = async () => {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/evaluate", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(`Evaluation failed: ${data?.error || `HTTP ${res.status}`}`);
        return;
      }
      if (!data || typeof data.classification === "undefined") {
        setError("Evaluation finished but the server returned malformed results.");
        return;
      }
      setResults(data);
    } catch (err: any) {
      setError(`Could not reach the backend: ${err?.message || "network error"}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 scrollbar-thin">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-apple-dark mb-2">Evaluation Dashboard</h2>
        <p className="text-sm text-apple-gray mb-6">
          Run the evaluation harness against the golden set (200 hand-labelled examples).
        </p>

        <button
          onClick={runEvaluation}
          disabled={running}
          className="px-6 py-2.5 bg-apple-blue text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-40 transition-colors mb-8"
        >
          {running ? "Running Evaluation..." : "Run Evaluation"}
        </button>

        {running && (
          <p className="text-sm text-apple-gray mb-6">
            Running the evaluation harness — this can take several minutes in LLM mode.
            The rest of the app stays responsive while it runs.
          </p>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            <span className="font-medium">Something went wrong:</span> {error}
          </div>
        )}

        {results && <ResultsDisplay results={results} />}

        {!results && !running && (
          <div className="bg-white rounded-xl p-8 shadow-sm border border-gray-100">
            <h3 className="text-lg font-semibold mb-4">How to run evaluation</h3>
            <ol className="text-sm text-apple-gray space-y-2 list-decimal list-inside">
              <li>Ensure the backend is running with <code className="bg-gray-100 px-1 rounded">GROQ_API_KEY</code> set</li>
              <li>Click "Run Evaluation" above, or run from CLI: <code className="bg-gray-100 px-1 rounded">npm run evaluate</code></li>
              <li>Results include classification accuracy, escalation F1, reply quality scores, and baseline comparisons</li>
            </ol>

            <div className="mt-6 p-4 bg-apple-lightgray rounded-lg">
              <h4 className="font-medium text-apple-dark mb-2">Golden Set</h4>
              <p className="text-sm text-apple-gray">
                200 examples sampled from 10 intent categories (20 each). Each labelled with intent, 
                escalation decision, and brand's historical response. Sampled randomly from Apple Support 
                Twitter conversations with keyword-based initial labels, reviewed for correctness.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsDisplay({ results }: { results: EvalResult }) {
  return (
    <div className="space-y-6">
      {/* Headline Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Intent Accuracy"
          value={`${(results.classification.accuracy * 100).toFixed(1)}%`}
          subtitle="Classification"
        />
        <MetricCard
          title="Escalation F1"
          value={`${(results.escalation.f1 * 100).toFixed(1)}%`}
          subtitle="Decision quality"
        />
        <MetricCard
          title="Reply Quality"
          value={`${results.replyQuality.overall.toFixed(1)}/5`}
          subtitle="LLM-as-judge"
        />
        <MetricCard
          title="Judge Agreement"
          value={`κ=${results.agreement.kappa.toFixed(2)}`}
          subtitle="Human alignment"
        />
      </div>

      {/* Per-Intent F1 */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold mb-4">Per-Intent F1 Scores</h3>
        <div className="space-y-3">
          {Object.entries(results.classification.perIntent).map(([intent, metrics]) => {
            const info = getIntentInfo(intent);
            return (
              <div key={intent} className="flex items-center space-x-3">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${info.color} w-36 text-center`}>
                  {info.icon} {info.label}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-full bg-apple-blue rounded-full transition-all"
                    style={{ width: `${metrics.f1 * 100}%` }}
                  />
                </div>
                <span className="text-sm font-mono w-12 text-right">
                  {(metrics.f1 * 100).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Baseline Comparison */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold mb-4">Baseline Comparison</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 text-apple-gray">Method</th>
              <th className="text-right py-2 text-apple-gray">Classification</th>
              <th className="text-right py-2 text-apple-gray">Escalation F1</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-2">Trivial (all "other")</td>
              <td className="text-right py-2 font-mono">{(results.baselines.trivial.classification * 100).toFixed(1)}%</td>
              <td className="text-right py-2 font-mono">{(results.baselines.trivial.escalation * 100).toFixed(1)}%</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2">Keyword matching</td>
              <td className="text-right py-2 font-mono">{(results.baselines.keyword.classification * 100).toFixed(1)}%</td>
              <td className="text-right py-2 font-mono">{(results.baselines.keyword.escalation * 100).toFixed(1)}%</td>
            </tr>
            <tr className="bg-blue-50 font-medium">
              <td className="py-2">Our Agent (LLM)</td>
              <td className="text-right py-2 font-mono">{(results.baselines.agent.classification * 100).toFixed(1)}%</td>
              <td className="text-right py-2 font-mono">{(results.baselines.agent.escalation * 100).toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Reply Quality Breakdown */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold mb-4">Reply Quality Breakdown</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(results.replyQuality).map(([key, value]) => (
            <div key={key} className="text-center">
              <div className="text-2xl font-bold text-apple-dark">{(value as number).toFixed(1)}</div>
              <div className="text-xs text-apple-gray capitalize">{key.replace(/_/g, " ")}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Failure Modes */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
        <h3 className="text-lg font-semibold mb-4">Top Failure Modes</h3>
        <div className="space-y-4">
          {results.failureModes.slice(0, 5).map((fm, i) => (
            <div key={i} className="p-3 bg-red-50 rounded-lg">
              <div className="flex justify-between items-start">
                <span className="font-medium text-sm text-red-800">{fm.mode}</span>
                <span className="text-xs text-red-600">{fm.count} occurrences</span>
              </div>
              {fm.examples.map((ex: any, j: number) => (
                <p key={j} className="text-xs text-red-600 mt-1">
                  "{ex.text}..."
                </p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center">
      <div className="text-2xl font-bold text-apple-dark">{value}</div>
      <div className="text-sm font-medium text-apple-dark">{title}</div>
      <div className="text-xs text-apple-gray">{subtitle}</div>
    </div>
  );
}
