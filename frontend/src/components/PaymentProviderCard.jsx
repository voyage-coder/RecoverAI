import StatusBadge from "./StatusBadge";

function StatusRow({ label, value, tone }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/8 bg-mist-soft/60 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {label}
      </p>
      {tone ? (
        <StatusBadge value={value} label={value} tone={tone} />
      ) : (
        <p className="text-sm font-medium text-ink">{value}</p>
      )}
    </div>
  );
}

function PaymentProviderCard({ status }) {
  const credentialsConfigured = status?.credentials_configured === true;
  const webhookSecretConfigured = status?.webhook_secret_configured === true;
  const dashboardConfigured = status?.webhook_dashboard_configured;

  let webhookLabel = "Unknown";
  let webhookTone = "neutral";
  if (dashboardConfigured === true) {
    webhookLabel = "Configured";
    webhookTone = "success";
  } else if (dashboardConfigured === false) {
    webhookLabel = "Not configured";
    webhookTone = "danger";
  } else if (webhookSecretConfigured) {
    webhookLabel = "Secret configured · Dashboard unknown";
    webhookTone = "warning";
  } else {
    webhookLabel = "Not configured";
    webhookTone = "danger";
  }

  return (
    <div className="rounded-[18px] border border-ink/10 bg-white p-5 sm:p-6">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Payment provider
      </p>
      <h3 className="mt-2 font-display text-2xl font-medium text-ink">
        {status?.provider || "Razorpay"}
      </h3>
      <p className="mt-1 text-sm text-ink-mute">
        Connect your payments so RecoverAI can recover failed revenue.
      </p>

      <div className="mt-5 space-y-2">
        <StatusRow
          label="Environment"
          value={status?.environment || "TEST"}
          tone="warning"
        />
        <StatusRow
          label="Status"
          value={
            credentialsConfigured
              ? "Configured"
              : status == null
                ? "Not available"
                : "Not configured"
          }
          tone={
            credentialsConfigured
              ? "success"
              : status == null
                ? "neutral"
                : "danger"
          }
        />
        <StatusRow
          label="Webhook"
          value={webhookLabel}
          tone={webhookTone}
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        Credentials configured securely — secrets stay on the backend. Public
        checkout keys are only used through the existing TEST checkout flow.
      </p>
    </div>
  );
}

export default PaymentProviderCard;
