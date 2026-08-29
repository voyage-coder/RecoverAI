import { useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

function loadRazorpayScript() {
  return new Promise((resolve, reject) => {
    if (window.Razorpay) {
      resolve(window.Razorpay);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(window.Razorpay);
    script.onerror = () =>
      reject(new Error("Could not load Razorpay checkout script."));
    document.body.appendChild(script);
  });
}

function RazorpayTestCheckout({ checkoutConfig, caseNumber, onComplete }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(null);
  const [paidOrderIds, setPaidOrderIds] = useState(() => new Set());

  const orderId = checkoutConfig?.order_id || null;
  const paymentRecovered =
    String(checkoutConfig?.payment_status || "").toUpperCase() ===
    "RECOVERED";
  const orderAlreadyPaidInSession =
    Boolean(orderId) && paidOrderIds.has(orderId);

  const canCheckout =
    checkoutConfig?.available &&
    orderId &&
    checkoutConfig?.razorpay_key_id &&
    !paymentRecovered &&
    !orderAlreadyPaidInSession;

  const paymentLink = checkoutConfig?.payment_link_url;

  const openCheckout = async () => {
    setError(null);
    setOpening(true);
    try {
      const Razorpay = await loadRazorpayScript();
      const options = {
        key: checkoutConfig.razorpay_key_id,
        amount: Number(checkoutConfig.amount),
        currency: checkoutConfig.currency || "INR",
        order_id: orderId,
        name: "RecoverAI",
        description: `TEST recovery · ${caseNumber || "case"}`,
        notes: {
          demo: "RAZORPAY_TEST_MODE",
          case_number: caseNumber,
        },
        handler: function () {
          if (orderId) {
            setPaidOrderIds((prev) => new Set(prev).add(orderId));
          }
          setOpening(false);
          onComplete?.(
            "TEST payment submitted to Razorpay. RecoverAI updates only after a verified payment.captured webhook reaches the backend — click Refresh. Localhost needs ngrok → POST /api/webhooks/razorpay."
          );
        },
        modal: {
          ondismiss: function () {
            setOpening(false);
          },
        },
      };
      const rzp = new Razorpay(options);
      rzp.on("payment.failed", function (response) {
        const desc =
          response?.error?.description ||
          response?.error?.reason ||
          "";
        setError(
          desc
            ? `Razorpay TEST payment failed: ${desc}`
            : "Razorpay TEST payment failed. Case status updates from backend only."
        );
        setOpening(false);
      });
      rzp.open();
    } catch (err) {
      console.error(err);
      setError(
        err.message ||
          "Checkout could not be opened. If preferences returned 400, this order may already be paid — wait for the webhook or create a fresh order."
      );
      setOpening(false);
    }
  };

  if (!checkoutConfig) {
    return (
      <p className="text-sm text-ink-mute">
        Waiting for backend checkout configuration…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sand/30 bg-sand-soft/40 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sand">
          {checkoutConfig.demo_label || "RAZORPAY TEST MODE"}
        </p>
        <p className="mt-1 text-xs text-ink-mute">
          Demo / test payment — not a live customer payment
        </p>
        {checkoutConfig.message && (
          <p className="mt-2 text-sm text-ink-soft">
            {checkoutConfig.message}
          </p>
        )}
      </div>

      {orderId && (
        <dl className="grid gap-2 font-mono text-xs text-ink-soft sm:grid-cols-2">
          <div>
            <dt className="text-ink-faint">order_id</dt>
            <dd className="mt-0.5 break-all">{orderId}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">amount</dt>
            <dd className="mt-0.5">
              {checkoutConfig.amount} {checkoutConfig.currency}
            </dd>
          </div>
        </dl>
      )}

      {(paymentRecovered || orderAlreadyPaidInSession) && (
        <div className="rounded-xl border border-pine/20 bg-pine-soft/40 px-4 py-3 text-sm text-ink-mute">
          {paymentRecovered
            ? "Payment is already RECOVERED in RecoverAI (verified webhook)."
            : "This Razorpay order was already paid in Checkout. Do not open Checkout again — that causes a preferences 400. Set up the webhook (ngrok) and Refresh until the case becomes RECOVERED."}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {canCheckout && (
          <button
            type="button"
            disabled={opening}
            onClick={openCheckout}
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-soft disabled:opacity-60"
          >
            {opening ? (
              <Loader2 size={15} className="animate-spin" />
            ) : null}
            Complete TEST payment
          </button>
        )}

        {paymentLink && !paymentRecovered && (
          <a
            href={paymentLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-pine/30 bg-pine-soft/50 px-4 py-2.5 text-sm font-semibold text-pine transition hover:bg-pine-soft"
          >
            Open TEST payment link
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      {error && (
        <p className="text-sm font-medium text-clay">{error}</p>
      )}

      <p className="text-xs text-ink-faint">
        TEST card: 4111 1111 1111 1111 · any future expiry · any CVV · OTP
        123456. Console lines for lumberjack/sentry (
        <span className="font-mono">ERR_BLOCKED_BY_CLIENT</span>) are from an
        ad blocker and can be ignored. A preferences{" "}
        <span className="font-mono">400</span> means this order cannot be
        checked out again (usually already paid).
      </p>
    </div>
  );
}

export default RazorpayTestCheckout;
