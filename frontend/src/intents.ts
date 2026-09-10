export const API_URL = import.meta.env.VITE_API_URL || '';

const INTENTS: Record<string, { label: string; color: string }> = {
  device_hardware: { label: "Device Hardware", color: "bg-red-100 text-red-800" },
  software_update: { label: "Software Update", color: "bg-blue-100 text-blue-800" },
  connectivity: { label: "Connectivity", color: "bg-green-100 text-green-800" },
  messaging: { label: "Messaging & Calls", color: "bg-purple-100 text-purple-800" },
  account_access: { label: "Account & Access", color: "bg-yellow-100 text-yellow-800" },
  billing_store: { label: "Billing & Store", color: "bg-orange-100 text-orange-800" },
  device_repair: { label: "Device Repair", color: "bg-gray-100 text-gray-800" },
  general_howto: { label: "General How-To", color: "bg-teal-100 text-teal-800" },
  complaint_frustration: { label: "Complaint", color: "bg-pink-100 text-pink-800" },
  other: { label: "Other", color: "bg-slate-100 text-slate-800" },
};

export interface AgentResult {
  id: string;
  customerText: string;
  classification: {
    intent: string;
    confidence: number;
    reasoning: string;
  };
  draftReply: string;
  escalation: {
    decision: "auto" | "escalate";
    reason: string;
    confidence: number;
  };
  conversationId: string;
  timestamp: string;
}

export function getIntentInfo(intent: string) {
  return INTENTS[intent] || INTENTS.other;
}

export { INTENTS };
