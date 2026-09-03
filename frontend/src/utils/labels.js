const LABEL_MAP = {
  // Case status
  ACTIVE: "Active",
  IN_PROGRESS: "In Progress",
  RECOVERED: "Recovered",
  ESCALATED: "Escalated",
  CLOSED: "Stopped",
  BLOCKED: "Blocked by safety rules",

  // Failure categories
  INSUFFICIENT_FUNDS: "Insufficient Funds",
  CARD_DECLINED: "Card Declined",
  EXPIRED_CARD: "Expired Card",
  GATEWAY_TIMEOUT: "Gateway Timeout",
  TECHNICAL_FAILURE: "Technical Failure",
  NETWORK_ERROR: "Network Error",
  BANK_SERVER_ERROR: "Bank Server Error",
  AUTHENTICATION_FAILED: "Authentication Failed",

  // Strategies
  IMMEDIATE_RETRY: "Immediate Retry",
  RETRY_AFTER_DELAY: "Retry After Delay",
  SEND_PAYMENT_LINK: "Send payment link",
  SEND_EMAIL_REMINDER: "Send Email Reminder",
  SEND_SMS_REMINDER: "Send SMS Reminder",
  SEND_WHATSAPP_MESSAGE: "Send WhatsApp Message",
  OFFER_ALT_PAYMENT_METHOD: "Offer Alt Payment Method",
  HUMAN_ESCALATION: "Human Escalation",
  STOP_RECOVERY: "Stop Recovery",

  // Action status
  PENDING: "Pending",
  PROCESSING: "Processing",
  EXECUTED: "Executed",
  FAILED: "Failed",

  // Recovery result
  PARTIALLY_RECOVERED: "Partially Recovered",
  FULLY_RECOVERED: "Fully Recovered",
  NOT_RECOVERED: "Not Recovered",

  // Risk
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",

  MANUAL: "Manual",
  AUTOMATIC: "Run agent on every case",
  APPROVAL_REQUIRED: "Manual",
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  OUTBOUND: "Outbound",
  INBOUND: "Inbound",
  AI_AGENT: "Automatic agent",
  SYSTEM: "System",
  CUSTOMER: "Customer",
  HUMAN_OPERATOR: "Merchant (manual)",
  SAFETY_ENGINE: "Safety Engine",
};

export function toLabel(value) {
  if (value == null || value === "") return "—";

  const key = String(value);

  if (LABEL_MAP[key]) return LABEL_MAP[key];

  return key
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const CASE_STATUSES = [
  "ACTIVE",
  "IN_PROGRESS",
  "RECOVERED",
  "ESCALATED",
  "CLOSED",
];

export const FAILURE_CATEGORIES = [
  "INSUFFICIENT_FUNDS",
  "CARD_DECLINED",
  "EXPIRED_CARD",
  "GATEWAY_TIMEOUT",
  "TECHNICAL_FAILURE",
  "AUTHENTICATION_FAILED",
];

export const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
