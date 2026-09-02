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
        description: `Payment recovery · ${caseNumber || "case"}`,
        notes: {
          case_number: caseNumber,
        },
        handler: function () {
          if (orderId) {
            setPaidOrderIds((prev) => new Set(prev).add(orderId));
          }
          setOpening(false);
          onComplete?.(
            "Payment submitted. Refresh after confirmation arrives."
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
            ? `Payment failed: ${desc}`
            : "Payment failed. Refresh after confirmation."
        );
        setOpening(false);
      });
      rzp.open();
    } catch (err) {
      console.error(err);
      setError(err.message || "Checkout could not be opened.");
      setOpening(false);
    }
  };

  if (!checkoutConfig) {
    return (
      <p className="text-sm text-ink-mute">Loading payment options…</p>
    );
  }

  return (
    <div className="space-y-3">
      {checkoutConfig.message && (
        <p className="text-sm text-ink-mute">{checkoutConfig.message}</p>
      )}

      {paymentLink && !paymentRecovered && (
        <p className="text-sm text-ink">
          Payment link:{" "}
          <a
            href={paymentLink}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-pine underline"
          >
            Click here
          </a>
        </p>
      )}

      {(paymentRecovered || orderAlreadyPaidInSession) && (
        <p className="text-sm text-ink-mute">
          {paymentRecovered
            ? "Payment recovered."
            : "This order is already paid. Refresh to update."}
        </p>
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
            Complete payment
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm font-medium text-clay">{error}</p>
      )}
    </div>
  );
}

export default RazorpayTestCheckout;
