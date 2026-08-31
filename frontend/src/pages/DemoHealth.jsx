import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { HeartPulse, Loader2 } from "lucide-react";
import LoadingState, { ErrorState } from "../components/LoadingState";
import {
  getDemoHealth,
  getDemoInventory,
  resetDemoData,
  parseApiError,
} from "../services/api";
import { formatDateTime, formatINR } from "../utils/format";

function Row({ label, value, ok }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/8 bg-mist-soft/50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      <p
        className={`text-sm font-medium ${
          ok === false ? "text-clay" : ok === true ? "text-pine" : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function DemoHealth() {
  const [health, setHealth] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthData, inventoryData] = await Promise.all([
        getDemoHealth(),
        getDemoInventory(),
      ]);
      if (healthData.secrets_returned) {
        setError("Health payload leaked secrets and was rejected.");
      }
      setHealth(healthData);
      setInventory(inventoryData);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onReset = async (event) => {
    event.preventDefault();
    setResetting(true);
    setResetMessage(null);
    try {
      const result = await resetDemoData(confirm);
      setResetMessage(result.detail);
      setConfirm("");
      await load();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setResetting(false);
    }
  };

  if (loading && !health) {
    return <LoadingState message="Checking RecoverAI health…" />;
  }
  if (error && !health) {
    return <ErrorState message={error} />;
  }

  const lastEvent = health?.last_provider_event;
  const lastWebhook = health?.last_verified_webhook;

  return (
    <div className="page-enter space-y-6">
      <section className="panel overflow-hidden">
        <div className="border-b border-ink/10 bg-mist-soft/50 px-5 py-6 sm:px-6">
          <p className="eyebrow">Demo tools</p>
          <h2 className="page-title">Demo health</h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">
            Check whether the demo is ready.
          </p>
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Row
          label="Backend connected"
          value={health?.backend_connected ? "Yes" : "No"}
          ok={health?.backend_connected}
        />
        <Row
          label="Database connected"
          value={health?.database_connected ? "Yes" : "No"}
          ok={health?.database_connected}
        />
        <Row
          label="Razorpay TEST credentials"
          value={
            health?.razorpay_credentials_configured
              ? `Configured · ${health.razorpay_key_id_hint || "key id stored"}`
              : "Not configured"
          }
          ok={health?.razorpay_credentials_configured}
        />
        <Row
          label="Razorpay connection test"
          value={
            health?.razorpay_connection_test_ok == null
              ? "Not run"
              : health.razorpay_connection_test_ok
                ? "Passed"
                : "Failed"
          }
          ok={health?.razorpay_connection_test_ok}
        />
        <Row
          label="Webhook secret"
          value={
            health?.webhook_secret_configured
              ? "Configured (secret hidden)"
              : "Not configured"
          }
          ok={health?.webhook_secret_configured}
        />
        <Row
          label="Webhook endpoint"
          value={health?.webhook_path || "/api/webhooks/razorpay"}
        />
        <Row
          label="Recovery mode"
          value={`${health?.recovery_mode || "MANUAL"}${
            health?.automatic_recovery_enabled ? " · automatic on" : " · automatic off"
          }`}
        />
        <Row
          label="Auto amount cap"
          value={
            health?.max_automatic_recovery_amount != null
              ? formatINR(health.max_automatic_recovery_amount)
              : "Not available"
          }
        />
        <Row
          label="Active recoveries"
          value={
            health?.active_recoveries != null
              ? String(health.active_recoveries)
              : "Not available"
          }
        />
        <Row
          label="Environment"
          value={health?.environment || "TEST"}
        />
      </div>

      <section className="panel p-5">
        <h3 className="font-display text-xl font-medium text-ink">
          Last events
        </h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-ink/8 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Last received provider event
            </p>
            <p className="mt-2 text-sm text-ink">
              {lastEvent
                ? `${lastEvent.label} · ${lastEvent.status}`
                : "None recorded"}
            </p>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              {lastEvent?.created_at
                ? formatDateTime(lastEvent.created_at)
                : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-ink/8 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              Last verified webhook
            </p>
            <p className="mt-2 text-sm text-ink">
              {lastWebhook
                ? `${lastWebhook.label} · ${lastWebhook.case_number}`
                : "None recorded"}
            </p>
            <p className="mt-1 font-mono text-xs text-ink-faint">
              {lastWebhook?.updated_at
                ? formatDateTime(lastWebhook.updated_at)
                : "—"}
            </p>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-center gap-2">
          <HeartPulse size={18} className="text-ink-mute" />
          <h3 className="font-display text-xl font-medium text-ink">
            Demo Reset
          </h3>
        </div>
        <p className="mt-2 text-sm text-ink-mute">
          Removes simulator / Create demo event records (`DEMO_EVENT`) only.
          Live provider webhook ingestions (`LIVE_PROVIDER`) and merchant
          settings are kept. Type the confirmation phrase to proceed.
        </p>
        {inventory && (
          <ul className="mt-4 grid gap-2 text-sm text-ink-mute sm:grid-cols-2">
            <li>Demo payments to remove: {inventory.demo_payments}</li>
            <li>Demo cases to remove: {inventory.demo_cases}</li>
            <li>
              Live payments preserved: {inventory.live_payments_preserved}
            </li>
            <li>
              Live verified recoveries preserved:{" "}
              {inventory.live_verified_recoveries_preserved}
            </li>
          </ul>
        )}
        <form className="mt-4 flex flex-wrap gap-2" onSubmit={onReset}>
          <input
            className="field font-mono sm:min-w-[16rem]"
            placeholder="CLEAR_DEMO_DATA"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={resetting || confirm !== "CLEAR_DEMO_DATA"}
            className="rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {resetting ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              "Clear demo data"
            )}
          </button>
        </form>
        {resetMessage && (
          <p className="mt-3 text-sm text-pine">{resetMessage}</p>
        )}
        {error && health && (
          <p className="mt-3 text-sm text-clay">{error}</p>
        )}
        <Link
          to="/integrations"
          className="mt-4 inline-block text-sm font-semibold text-pine hover:underline"
        >
          Back to onboarding
        </Link>
      </section>
    </div>
  );
}

export default DemoHealth;
