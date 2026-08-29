import axios from "axios";

// Prefer VITE_API_URL when set.
// In local Vite dev, default to same-origin so /api is proxied (avoids CORS).
// In production, point at the FastAPI server unless overridden.
const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? "" : "http://127.0.0.1:8000");

const api = axios.create({
  baseURL: API_BASE_URL,
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

export const executePendingRecoveryAction = async (caseId) => {
  const response = await api.post(
    `/api/recovery/cases/${caseId}/execute-pending-action`
  );
  return response.data;
};

export const continueRecovery = async (caseId) => {
  const response = await api.post(
    `/api/recovery/cases/${caseId}/continue-recovery`
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

export function parseApiError(error) {
  if (!error?.response) {
    return "RecoverAI API is unavailable. Make sure the backend is running on port 8000.";
  }

  const detail = error.response.data?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => item.msg || item.message || "Invalid field")
      .join(" · ");
  }

  if (error.response.status === 422) {
    return "Invalid request — check amount, customer, and failure details.";
  }

  if (error.response.status >= 500) {
    return "RecoverAI server error. Try again in a moment.";
  }

  return "Request failed. Check your inputs and try again.";
}

export default api;
