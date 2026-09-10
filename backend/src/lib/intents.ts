export const INTENTS = {
  device_hardware: {
    label: "Device Hardware",
    description: "Issues with iPhone/iPad/Mac hardware: battery drain, screen problems, physical damage, buttons not working, speakers, camera",
    keywords: ["battery", "drain", "screen", "cracked", "shatter", "broken", "button", "speaker", "camera", "overheating", "heat", "hardware"],
    autoHandleRate: 0.3,
  },
  software_update: {
    label: "Software Update",
    description: "iOS/macOS update problems: stuck updating, failed update, new bugs after update, slow after update",
    keywords: ["update", "ios", "upgrade", "bug", "glitch", "stuck", "download"],
    autoHandleRate: 0.7,
  },
  connectivity: {
    label: "Connectivity",
    description: "WiFi, Bluetooth, cellular connection issues, AirDrop not working, hotspot problems",
    keywords: ["wifi", "wi-fi", "bluetooth", "connect", "airdrop", "hotspot", "signal", "network", "pairing", "pair"],
    autoHandleRate: 0.65,
  },
  messaging: {
    label: "Messaging & Calls",
    description: "iMessage, FaceTime, SMS issues: not sending, not receiving, blue/green bubble problems",
    keywords: ["imessage", "message", "facetime", "call", "text", "send", "receive", "blue", "green bubble", "sms"],
    autoHandleRate: 0.6,
  },
  account_access: {
    label: "Account & Access",
    description: "Apple ID, password reset, iCloud login, two-factor authentication, account locked/disabled",
    keywords: ["apple id", "password", "icloud", "login", "log in", "sign in", "locked", "disabled", "two-factor", "2fa", "account"],
    autoHandleRate: 0.25,
  },
  billing_store: {
    label: "Billing & Store",
    description: "iTunes/App Store purchases, payment issues, subscriptions, refunds, billing errors",
    keywords: ["itunes", "app store", "purchase", "charge", "bill", "refund", "subscription", "payment", "buy", "paid"],
    autoHandleRate: 0.35,
  },
  device_repair: {
    label: "Device Repair",
    description: "Physical repair needs, warranty claims, AppleCare, device replacement, Genius Bar appointments",
    keywords: ["repair", "warranty", "applecare", "replace", "replacement", "genius bar", "appointment"],
    autoHandleRate: 0.15,
  },
  general_howto: {
    label: "General How-To",
    description: "General how-to questions, feature explanations, settings guidance, tips",
    keywords: ["how do", "how can", "how to", "can i", "is there", "where is", "what is", "help me", "what does", "should i"],
    autoHandleRate: 0.85,
  },
  complaint_frustration: {
    label: "Complaint / Frustration",
    description: "Customer expressing frustration, dissatisfaction, threat to switch brands, general complaints",
    keywords: ["worst", "hate", "terrible", "awful", "angry", "frustrat", "unacceptable", "ridiculous", "done", "switch"],
    autoHandleRate: 0.1,
  },
  other: {
    label: "Other",
    description: "Anything that doesn't fit the above categories",
    keywords: [],
    autoHandleRate: 0.5,
  },
} as const;

export type IntentKey = keyof typeof INTENTS;

export interface ClassificationResult {
  intent: IntentKey;
  confidence: number;
  reasoning: string;
}

export interface EscalationDecision {
  decision: "auto" | "escalate";
  reason: string;
  confidence: number;
}

export interface AgentResponse {
  id: string;
  customerText: string;
  classification: ClassificationResult;
  draftReply: string;
  escalation: EscalationDecision;
  timestamp: string;
}
