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

export default api;
