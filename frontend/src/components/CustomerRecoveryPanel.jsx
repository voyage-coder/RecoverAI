import { useCallback, useEffect, useState } from "react";
import { Copy, ExternalLink, Link2, Loader2 } from "lucide-react";
import StatusBadge from "./StatusBadge";
import {
  createCustomerRecoveryLink,
  getCustomerRecoveryLinkStatus,
  parseApiError,
} from "../services/api";
import { formatDateTime } from "../utils/format";

function CustomerRecoveryPanel({ caseId, caseStatus }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [recoveryPath, setRecoveryPath] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomerRecoveryLinkStatus(caseId);
      setStatus(data);
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, caseStatus]);

  const fullUrl = recoveryPath
    ? `${window.location.origin}${recoveryPath}`
    : null;

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setCopied(false);
    try {
      const data = await createCustomerRecoveryLink(caseId);
      setStatus(data);
      setRecoveryPath(data.recovery_path || null);
    } catch (err) {
      console.error(err);
      setError(parseApiError(err));
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading && !status) {
    return (
      <p className="text-sm text-ink-mute">Loading customer recovery…</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Pay as customer
          </p>
          <p className="mt-1 text-sm text-ink-mute">
            Generate a secure payment link for this case.
          </p>
        </div>
        {status?.status && (
          <StatusBadge value={status.status} label={status.status} />
        )}
      </div>

      <div className="grid gap-2 text-xs text-ink-mute sm:grid-cols-2">
        <p>
          Expires:{" "}
          <span className="font-mono text-ink">
            {status?.expires_at
              ? formatDateTime(status.expires_at)
              : "Not available"}
          </span>
        </p>
        <p>
          Opened:{" "}
          <span className="font-mono text-ink">
            {status?.first_opened_at
              ? formatDateTime(status.first_opened_at)
              : "Not yet"}
          </span>
        </p>
      </div>

      {fullUrl && (
        <div className="rounded-xl border border-pine/20 bg-pine-soft/30 px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-pine">
            Recovery link
          </p>
          <p className="mt-2 break-all font-mono text-xs text-ink">{fullUrl}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={generating || String(caseStatus).toUpperCase() === "RECOVERED"}
          onClick={generate}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:opacity-60"
        >
          {generating ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Link2 size={15} />
          )}
          {status?.has_active_link || recoveryPath
            ? "Regenerate payment link"
            : "Generate payment link"}
        </button>

        {fullUrl && (
          <>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-2 rounded-xl border border-ink/10 bg-white px-4 py-2.5 text-sm font-semibold text-ink"
            >
              <Copy size={15} />
              {copied ? "Copied" : "Copy link"}
            </button>
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl border border-pine/30 bg-pine-soft/40 px-4 py-2.5 text-sm font-semibold text-pine"
            >
              Pay as customer
              <ExternalLink size={14} />
            </a>
          </>
        )}
      </div>

      {error && (
        <p className="text-sm text-clay">{error}</p>
      )}

      {status?.note && (
        <p className="text-xs text-ink-faint">{status.note}</p>
      )}
      <p className="text-xs text-ink-faint">
        After you regenerate, only the newest Pay as customer URL works.
        Do not reuse an old tab or an old Click here from earlier messages.
      </p>
    </div>
  );
}

export default CustomerRecoveryPanel;
