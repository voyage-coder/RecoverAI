import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import {
  getMerchantSettings,
  updateMerchantSettings,
  parseApiError,
} from "../services/api";
import { formatINR } from "../utils/format";

const MODES = [
  {
    id: "MANUAL",
    label: "Manual",
    detail: "Merchant executes every approved recovery action.",
  },
  {
    id: "APPROVAL_REQUIRED",
    label: "Approval required",
    detail: "Actions wait in Operations until a merchant reviews them.",
  },
  {
    id: "AUTOMATIC",
    label: "Automatic",
    detail:
      "Executes Safety Engine–approved actions within your amount limits.",
  },
];

function Settings() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState({
    recovery_mode: "MANUAL",
    automatic_recovery_enabled: false,
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
        recovery_mode: data.recovery_mode || "MANUAL",
        automatic_recovery_enabled: Boolean(
          data.automatic_recovery_enabled
        ),
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
    try {
      const data = await updateMerchantSettings({
        recovery_mode: form.recovery_mode,
        automatic_recovery_enabled: form.automatic_recovery_enabled,
        max_automatic_recovery_amount:
          Math.round(Number(form.max_automatic_recovery_amount) * 100),
        max_retry_attempts: Number(form.max_retry_attempts),
        payment_link_expiry_hours: Number(form.payment_link_expiry_hours),
        high_value_approval_threshold:
          Math.round(Number(form.high_value_approval_threshold) * 100),
      });
      setSettings(data);
      const run = data.automatic_run;
      if (run?.ran) {
        setMessage(
          `Policy saved. Agent processed ${run.considered} open case(s): ` +
            `${run.executed} action(s) run, ${run.skipped} skipped ` +
            `(cap, safety, waiting, or already acted).` +
            (run.failed ? ` ${run.failed} failed.` : "")
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
          Set how RecoverAI runs recovery actions. Switching to{" "}
          <span className="font-semibold text-ink">Automatic</span> runs the
          agent on every open case that is still allowed (under your rupee
          cap, Safety Engine, not escalated). Payment keys are on{" "}
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
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {MODES.map((mode) => (
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
                        automatic_recovery_enabled: mode.id === "AUTOMATIC",
                      }))
                    }
                  />
                  <p className="text-sm font-semibold text-ink">{mode.label}</p>
                  <p className="mt-1 text-xs text-ink-mute">{mode.detail}</p>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-ink-mute">
              Automatic runs show as <span className="font-semibold">Agent</span>{" "}
              on the case. Actions you run from Operations or the case page show
              as <span className="font-semibold">Manual</span>.
            </p>
          </div>

          <label className="flex items-center gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={form.automatic_recovery_enabled}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  automatic_recovery_enabled: e.target.checked,
                }))
              }
            />
            Enable automatic recovery (only when mode is Automatic)
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Max automatic amount (₹)
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
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                High-value approval threshold (₹)
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
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Max retry attempts
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
            </div>
          </div>

          {settings && (
            <p className="text-xs text-ink-faint">
              Current automatic cap:{" "}
              {formatINR(settings.max_automatic_recovery_amount)} · High-value
              from {formatINR(settings.high_value_approval_threshold)}
            </p>
          )}

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
