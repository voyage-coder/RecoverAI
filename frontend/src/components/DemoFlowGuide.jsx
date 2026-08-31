import { Link } from "react-router-dom";

const STEPS = [
  "Open Create demo event and send payment.failed",
  "Open the recovery case",
  "Review the AI recovery decision",
  "Run the recommended action",
  "Customer pays with checkout or the payment link",
  "Wait for the verified webhook, then refresh",
];

function DemoFlowGuide({ title = "Demo walkthrough" }) {
  return (
    <div className="rounded-xl border border-dashed border-ink/15 bg-mist-soft/50 px-4 py-4">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs text-ink-mute">
        Use a new test event each time. Recovered only after a verified webhook.
      </p>
      <ol className="mt-3 space-y-1.5 text-sm text-ink-soft">
        {STEPS.map((step, index) => (
          <li key={step}>
            <span className="font-mono text-xs text-ink-faint">
              {index + 1}.
            </span>{" "}
            {index === 0 ? (
              <>
                Open{" "}
                <Link to="/event-console" className="font-semibold text-pine">
                  Create demo event
                </Link>{" "}
                and send payment.failed
              </>
            ) : (
              step
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default DemoFlowGuide;
