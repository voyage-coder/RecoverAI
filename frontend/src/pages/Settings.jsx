import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  getMerchantSettings,
  updateMerchantSettings,
  parseApiError,
} from "../services/api";
import { formatINR } from "../utils/format";
import {
  RECOVERY_MODES,
  normalizeRecoveryMode,
} from "../utils/recoveryMode";

function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState({
    recovery_mode: "MANUAL",
    max_automatic_recovery_amount: "5000",
    max_retry_attempts: "3",
    payment_link_expiry_hours: "72",
    high_value_approval_threshold: "10000",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMerchantSettings();
      setSettings(data);
      setForm({
        recovery_mode: normalizeRecoveryMode(data.recovery_mode),
        max_automatic_recovery_amount: String(
          Math.round((data.max_automatic_recovery_amount || 0) / 100)
        ),
        max_retry_attempts: String(data.max_retry_attempts ?? 3),
        payment_link_expiry_hours: String(
          data.payment_link_expiry_hours ?? 72
        ),
        high_value_approval_threshold: String(
          Math.round((data.high_value_approval_threshold || 0) / 100)
        ),
      });
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    const mode = normalizeRecoveryMode(form.recovery_mode);
    try {
      const data = await updateMerchantSettings({
        recovery_mode: mode,
        automatic_recovery_enabled: mode === "AUTOMATIC",
        max_automatic_recovery_amount:
          Math.round(Number(form.max_automatic_recovery_amount) * 100),
        max_retry_attempts: Number(form.max_retry_attempts),
        payment_link_expiry_hours: Number(form.payment_link_expiry_hours),
        high_value_approval_threshold:
          Math.round(Number(form.high_value_approval_threshold) * 100),
      });
      setSettings(data);
      if (mode === "AUTOMATIC") {
        setMessage(
          "Saved. Eligible cases now show Run Agent. Nothing ran automatically — trigger one case at a time."
        );
      } else {
        setMessage("Recovery policy saved.");
      }
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-enter space-y-6">
      <div>
        <p className="eyebrow">Configuration</p>
        <h2 className="page-title">Settings</h2>
        <p className="mt-2 max-w-2xl text-sm text-ink-mute">
          Two modes for the demo.{" "}
          <span className="font-semibold text-ink">Manual</span> — you click
          Execute.{" "}
          <span className="font-semibold text-ink">
            Run agent on every case
          </span>{" "}
          — after save, each eligible case gets a Run Agent button. The agent
          runs only when you click it. Neither mode marks Recovered; only a
          Razorpay webhook does. Keys are on{" "}
          <Link to="/integrations" className="font-semibold text-pine">
            Connect payments
          </Link>
          .
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-ink-mute">Loading policy…</p>
      ) : (
        <form onSubmit={save} className="panel space-y-5 p-5 sm:p-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Recovery mode
            </p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {RECOVERY_MODES.map((mode) => (
                <label
                  key={mode.id}
                  className={`cursor-pointer rounded-xl border px-4 py-3 ${
                    form.recovery_mode === mode.id
                      ? "border-pine/40 bg-pine-soft/30"
                      : "border-ink/10 bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name="recovery_mode"
                    checked={form.recovery_mode === mode.id}
                    onChange={() =>
                      setForm((prev) => ({
                        ...prev,
                        recovery_mode: mode.id,
                      }))
                    }
                  />
                  <p className="text-sm font-semibold text-ink">{mode.label}</p>
                  <p className="mt-1 text-xs text-ink-mute">{mode.detail}</p>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-mute">
              Agent-run actions show as{" "}
              <span className="font-semibold">Agent</span> on the case.
              Execute that you click shows as{" "}
              <span className="font-semibold">Manual</span>. Saving this policy
              does not process cases.
            </p>
          </div>

          <details className="rounded-xl border border-ink/10 bg-mist-soft/40 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              Advanced limits (optional)
            </summary>
            <p className="mt-2 text-xs text-ink-mute">
              Not required for the demo. Leave the defaults. These are merchant
              policy limits, separate from the Safety Engine. Safety still
              blocks unsafe strategies even if an amount is under the cap.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Agent rupee limit
              </label>
              <input
                type="number"
                min="1"
                className="field font-mono"
                value={form.max_automatic_recovery_amount}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    max_automatic_recovery_amount: e.target.value,
                  }))
                }
              />
              <p className="mt-1 text-[11px] text-ink-faint">
                If the failed payment is more than this, the agent will not
                send anything. Switch to Manual and click Execute.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Large payment — you run it (₹)
              </label>
              <input
                type="number"
                min="1"
                className="field font-mono"
                value={form.high_value_approval_threshold}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    high_value_approval_threshold: e.target.value,
                  }))
                }
              />
              <p className="mt-1 text-[11px] text-ink-faint">
                At this amount or more, the agent will not send anything. You
                run it in Manual.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Max payment retries
              </label>
              <input
                type="number"
                min="0"
                className="field font-mono"
                value={form.max_retry_attempts}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    max_retry_attempts: e.target.value,
                  }))
                }
              />
              <p className="mt-1 text-[11px] text-ink-faint">
                Only counts charging the original card/UPI again. Not a cap on
                all strategies. After retries, a payment link can still run.
              </p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Payment-link expiry (hours)
              </label>
              <input
                type="number"
                min="1"
                className="field font-mono"
                value={form.payment_link_expiry_hours}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    payment_link_expiry_hours: e.target.value,
                  }))
                }
              />
              <p className="mt-1 text-[11px] text-ink-faint">
                How long a customer pay link stays valid.
              </p>
            </div>
            </div>
            {settings && (
              <p className="mt-3 text-xs text-ink-faint">
                Agent cap: {formatINR(settings.max_automatic_recovery_amount)} ·
                High-value from{" "}
                {formatINR(settings.high_value_approval_threshold)}
              </p>
            )}
          </details>

          {error && <p className="text-sm font-medium text-clay">{error}</p>}
          {message && <p className="text-sm font-medium text-pine">{message}</p>}

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save policy
          </button>
        </form>
      )}
    </div>
  );
}

export default Settings;
