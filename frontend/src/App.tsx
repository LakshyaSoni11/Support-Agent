import { useState } from "react";
import ChatPanel from "./components/ChatPanel";
import EvalPanel from "./components/EvalPanel";
import ExamplesPanel from "./components/ExamplesPanel";

type Tab = "chat" | "eval" | "examples";

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "chat", label: "Agent Chat", icon: "💬" },
  { id: "eval", label: "Evaluation", icon: "📊" },
  { id: "examples", label: "Golden Set", icon: "📝" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("chat");

  return (
    <div className="h-screen flex flex-col bg-apple-lightgray">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🍎</span>
            <div>
              <h1 className="text-lg font-semibold text-apple-dark">
                Apple Support AI Agent
              </h1>
              <p className="text-xs text-apple-gray">
                Intent Classification • Reply Drafting • Escalation Decisions
              </p>
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex space-x-1 bg-apple-lightgray rounded-lg p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "bg-white text-apple-dark shadow-sm"
                    : "text-apple-gray hover:text-apple-dark"
                }`}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        <div className={activeTab === "chat" ? "h-full" : "hidden"}>
          <ChatPanel />
        </div>
        <div className={activeTab === "eval" ? "h-full" : "hidden"}>
          <EvalPanel />
        </div>
        <div className={activeTab === "examples" ? "h-full" : "hidden"}>
          <ExamplesPanel />
        </div>
      </main>
    </div>
  );
}
