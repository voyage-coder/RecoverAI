import axios from "axios";

function resolveApiBaseUrl() {
  const raw = String(import.meta.env.VITE_API_URL || "")
    .trim()
    .replace(/\/$/, "");
  const looksLikeUrl = /^https?:\/\/.+/i.test(raw);
  if (looksLikeUrl) {
    return raw;
  }
  // Local Vite: same-origin so /api is proxied.
  if (import.meta.env.DEV) {
    return "";
  }
  return "";
}

const API_BASE_URL = resolveApiBaseUrl();

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 45000,
  headers: {
    "Content-Type": "application/json",
  },
});

export const getDashboardOverview = async () => {
  const response = await api.get("/api/dashboard/overview");
  return response.data;
};

export const getRecentActivity = async () => {
  const response = await api.get("/api/dashboard/recent-activity");
  return response.data;
};

export const getFailureCategories = async () => {
  const response = await api.get("/api/dashboard/failure-categories");
  return response.data;
};

export const getRecoveryCases = async () => {
  const response = await api.get("/api/recovery/cases");
  return response.data;
};

export const getRecoveryCase = async (caseId) => {
  const response = await api.get(`/api/recovery/cases/${caseId}`);
  return response.data;
};

export const getCaseTimeline = async (caseId) => {
  const response = await api.get(`/api/recovery/cases/${caseId}/timeline`);
  return response.data;
};

export const getCaseDecision = async (caseId) => {
  const response = await api.get(`/api/recovery/cases/${caseId}/decision`);
  return response.data;
};

export const getCasePaymentDetails = async (caseId) => {
  const response = await api.get(
    `/api/recovery/cases/${caseId}/payment-details`
  );
  return response.data;
};

export const runPaymentRecovery = async (paymentId) => {
  const response = await api.post(`/api/recovery/payments/${paymentId}/run`);
  return response.data;
};

export const ingestPaymentEvent = async (payload) => {
  const response = await api.post("/api/events/payment", payload);
  return response.data;
};

export const getProviderEventCapabilities = async () => {
  const response = await api.get("/api/events/capabilities");
  return response.data;
};

export const getRecentProviderEvents = async (limit = 40) => {
  const response = await api.get("/api/events/recent", {
    params: { limit },
  });
  return response.data;
};

export const acknowledgeProviderEvent = async (payload) => {
  const response = await api.post("/api/events/acknowledge", payload);
  return response.data;
};

const AGENT_TIMEOUT_MS = 300000;

export const executePendingRecoveryAction = async (caseId) => {
  const response = await api.post(
    `/api/recovery/cases/${caseId}/execute-pending-action`,
    null,
    { timeout: AGENT_TIMEOUT_MS }
  );
  return response.data;
};

export const continueRecovery = async (caseId) => {
  const response = await api.post(
    `/api/recovery/cases/${caseId}/continue-recovery`,
    null,
    { timeout: AGENT_TIMEOUT_MS }
  );
  return response.data;
};

export const runRecoveryAgent = async (caseId) => {
  const response = await api.post(
    `/api/recovery/cases/${caseId}/run-agent`,
    null,
    { timeout: AGENT_TIMEOUT_MS }
  );
  return response.data;
};

export const getCheckoutConfig = async (caseId) => {
  const response = await api.get(
    `/api/recovery/cases/${caseId}/checkout-config`
  );
  return response.data;
};

export const getCustomerRecoveryLinkStatus = async (caseId) => {
  const response = await api.get(
    `/api/recovery/cases/${caseId}/customer-recovery-link`
  );
  return response.data;
};

export const createCustomerRecoveryLink = async (caseId) => {
  const response = await api.post(
    `/api/recovery/cases/${caseId}/customer-recovery-link`
  );
  return response.data;
};

export const getCustomerRecoveryByToken = async (token) => {
  const response = await api.get(`/api/customer/recovery/${token}`);
  return response.data;
};

export const getIntegrationStatus = async () => {
  const response = await api.get("/api/integrations/status");
  return response.data;
};

export const getMerchantSettings = async () => {
  const response = await api.get("/api/integrations/settings");
  return response.data;
};

export const updateMerchantSettings = async (payload) => {
  const response = await api.put("/api/integrations/settings", payload);
  return response.data;
};

export const saveRazorpayCredentials = async (payload) => {
  const response = await api.post(
    "/api/integrations/razorpay-credentials",
    payload
  );
  return response.data;
};

export const testRazorpayConnection = async () => {
  const response = await api.post("/api/integrations/test-connection");
  return response.data;
};

export const getDemoHealth = async () => {
  const response = await api.get("/api/demo/health");
  return response.data;
};

export const getDemoInventory = async () => {
  const response = await api.get("/api/demo/inventory");
  return response.data;
};

export const resetDemoData = async (confirmation) => {
  const response = await api.post("/api/demo/reset", { confirmation });
  return response.data;
};

export const simulateNotification = async (caseId, channel) => {
  const response = await api.post("/api/demo/notify", {
    case_id: caseId,
    channel,
  });
  return response.data;
};

export function parseApiError(error) {
  if (error?.code === "ECONNABORTED" || /timeout/i.test(String(error?.message || ""))) {
    return (
      "This is still running on the server (AI or Razorpay can take a while). " +
      "Wait a couple of minutes, then refresh. Do not click Run Agent again yet."
    );
  }
  if (!error?.response) {
    return "Backend unavailable. Set VITE_API_URL to your Render API origin (no /api suffix) and enable CORS.";
  }

  const detail = error.response.data?.detail;
  const status = error.response.status;

  if (status === 409) {
    return (
      "This case is already running. Wait, then refresh. " +
      "Do not click Run Agent or Execute again."
    );
  }

  if (typeof detail === "string") {
    const lower = detail.toLowerCase();
    if (lower.includes("razorpay") || lower.includes("connection test")) {
      return `Razorpay unavailable — ${detail}`;
    }
    if (lower.includes("approval")) {
      return `Approval required — ${detail}`;
    }
    if (lower.includes("safety") || lower.includes("blocked")) {
      return `Safety blocked — ${detail}`;
    }
    if (lower.includes("webhook") && lower.includes("not")) {
      return `Webhook not received — ${detail}`;
    }
    if (lower.includes("awaiting") || lower.includes("customer")) {
      return `Payment awaiting customer — ${detail}`;
    }
    if (lower.includes("closed") || lower.includes("stopped")) {
      return `Recovery stopped — ${detail}`;
    }
    if (lower.includes("retry unavailable") || lower.includes("no pending")) {
      return `Retry unavailable — ${detail}`;
    }
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item.msg || item.message || "Invalid field")
      .join(" · ");
  }

  if (status === 401) {
    return "Webhook signature was invalid or missing.";
  }
  if (status === 503) {
    return "Backend or webhook configuration is incomplete.";
  }
  if (status === 422) {
    return "Invalid request — check amount, customer, and failure details.";
  }
  if (status >= 500) {
    return "RecoverAI server error. Try again in a moment.";
  }

  return "Request failed. Check your inputs and try again.";
}

export default api;
