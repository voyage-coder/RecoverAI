import { Link } from "react-router-dom";

const STEPS = [
  "Open Provider Event Console (/event-console)",
  "Send a simulated payment.failed event",
  "Open the generated recovery case",
  "Review AI diagnosis, strategy, and safety outcome",
  "Click Execute pending recovery action (operator step)",
  "Generate customer recovery link if needed",
  "Complete Razorpay TEST checkout or open TEST payment link",
  "Wait for verified payment.captured webhook",
  "Refresh case — expect RECOVERED from backend only",
  "Return to Dashboard — amount recovered increases from API",
];

function DemoFlowGuide({ title = "Fresh demo walkthrough" }) {
  return (
    <div className="rounded-xl border border-dashed border-ink/15 bg-mist-soft/50 px-4 py-4">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs text-ink-mute">
        No database reset — each run uses a new simulated event. Payment
        completion is always operator-driven in TEST MODE.
      </p>
      <ol className="mt-3 space-y-1.5 text-sm text-ink-soft">
        {STEPS.map((step, index) => (
          <li key={step}>
            <span className="font-mono text-xs text-ink-faint">
              {index + 1}.
            </span>{" "}
            {step.startsWith("Open Provider") ? (
              <>
                Open{" "}
                <Link to="/event-console" className="font-semibold text-pine">
                  Provider Event Console
                </Link>
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
