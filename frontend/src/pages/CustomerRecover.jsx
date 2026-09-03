import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ExternalLink, Loader2 } from "lucide-react";
import {
  getCustomerRecoveryByToken,
  parseApiError,
} from "../services/api";
import { formatINR } from "../utils/format";

const POLL_MS = 5000;

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
      reject(new Error("Could not load secure checkout."));
    document.body.appendChild(script);
  });
}

function CustomerRecover() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorKind, setErrorKind] = useState(null);
  const [opening, setOpening] = useState(false);
  const [checkoutNote, setCheckoutNote] = useState(null);

  const load = useCallback(async () => {
    if (!token) {
      setErrorKind("invalid");
      setError("This recovery link is invalid.");
      setLoading(false);
      return;
    }

    try {
      const payload = await getCustomerRecoveryByToken(token);
      setData(payload);
      setError(null);
      setErrorKind(null);
    } catch (err) {
      const status = err?.response?.status;
      if (status === 410) {
        setErrorKind("expired");
        setError("This recovery link has expired.");
      } else if (status === 404) {
        setErrorKind("invalid");
        setError(
          err?.response?.data?.detail ||
            "This recovery link is invalid."
        );
      } else {
        setErrorKind("unavailable");
        setError(parseApiError(err));
      }
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (!data) return undefined;
    const status = data.customer_status;
    const shouldPoll =
      status === "action_required" ||
      status === "payment_pending" ||
      status === "pending";
    if (!shouldPoll) return undefined;

    const id = window.setInterval(() => {
      load();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [data, load]);

  const openCheckout = async () => {
    const checkout = data?.checkout;
    if (!checkout?.available || !checkout.order_id || !checkout.razorpay_key_id) {
      setCheckoutNote(
        "Secure payment is not ready yet. Please try again shortly."
      );
      return;
    }

    setOpening(true);
    setCheckoutNote(null);
    try {
      const Razorpay = await loadRazorpayScript();
      const options = {
        key: checkout.razorpay_key_id,
        amount: Number(checkout.amount),
        currency: checkout.currency || "INR",
        order_id: checkout.order_id,
        name: "RecoverAI",
        description: "Complete your payment",
        notes: {
          demo: "RAZORPAY_TEST_MODE",
        },
        handler: function () {
          setOpening(false);
          setCheckoutNote(
            "Payment submitted. Confirming securely… this page updates when confirmation completes."
          );
          // Never mark recovered from client callback.
          window.setTimeout(() => load(), 1500);
        },
        modal: {
          ondismiss: function () {
            setOpening(false);
          },
        },
      };
      const rzp = new Razorpay(options);
      rzp.on("payment.failed", function () {
        setOpening(false);
        setCheckoutNote(
          "Payment could not be completed. You can try again."
        );
      });
      rzp.open();
    } catch (err) {
      console.error(err);
      setOpening(false);
      setCheckoutNote(err.message || "Checkout could not be opened.");
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3f1ec] px-4">
        <div className="flex items-center gap-2 text-sm text-[#5c584f]">
          <Loader2 size={16} className="animate-spin" />
          Loading secure payment…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3f1ec] px-4">
        <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#8a8478]">
            RecoverAI
          </p>
          <h1 className="mt-3 font-serif text-2xl text-[#1c1a16]">
            {errorKind === "expired"
              ? "Link expired"
              : errorKind === "invalid"
                ? "Link unavailable"
                : "Temporarily unavailable"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[#5c584f]">
            {error}
          </p>
          {errorKind === "expired" ? (
            <p className="mt-3 text-sm leading-relaxed text-[#5c584f]">
              On the merchant case, click Generate payment link (or use the
              newest Click here), then open that URL. An older tab will show
              expired after a new link is created.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const recovered = data?.customer_status === "recovered";
  const paymentLink = data?.checkout?.payment_link_url || null;
  const canPay =
    data?.payment_action_available &&
    data?.checkout?.available &&
    data?.checkout?.order_id &&
    data?.checkout?.razorpay_key_id;

  return (
    <div className="min-h-screen bg-[#f3f1ec] px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8a8478]">
          RecoverAI
        </p>
        <div className="mt-4 rounded-2xl border border-black/10 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="font-serif text-3xl leading-tight text-[#1c1a16]">
            {recovered ? "Payment recovered successfully" : "Complete your payment"}
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[#5c584f]">
            {recovered
              ? "Thank you. Your payment has been confirmed."
              : "Use the button below to pay securely."}
          </p>

          <div className="mt-8 rounded-xl border border-black/8 bg-[#f7f5f0] px-4 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a8478]">
              {recovered ? "Amount recovered" : "Amount due"}
            </p>
            <p className="mt-1 font-mono text-3xl text-[#1c1a16]">
              {formatINR(
                recovered
                  ? data.recovered_amount ?? data.amount
                  : data.amount
              )}
            </p>
            <p className="mt-3 text-xs text-[#5c584f]">
              {recovered
                ? "Status: Payment completed"
                : data.customer_status === "payment_pending"
                  ? "Status: Confirming payment"
                  : "Status: Payment action required"}
            </p>
            <p className="mt-1 text-xs text-[#8a8478]">
              Secure payment · {data.currency || "INR"}
            </p>
          </div>

          {recovered ? (
            <div className="mt-6 rounded-xl border border-[#2f6b4f]/20 bg-[#e8f3ec] px-4 py-3 text-sm text-[#245540]">
              Payment recovered successfully
            </div>
          ) : canPay ? (
            <button
              type="button"
              disabled={opening}
              onClick={openCheckout}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1c1a16] px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-[#2c2923] disabled:opacity-60"
            >
              {opening ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Opening checkout…
                </>
              ) : (
                "Continue payment"
              )}
            </button>
          ) : (
            <p className="mt-6 text-sm text-[#5c584f]">
              {data.customer_status === "payment_pending"
                ? "Waiting for payment confirmation…"
                : paymentLink
                  ? "Use the payment link below to pay securely."
                  : "A payment action is not available on this link right now."}
            </p>
          )}

          {!recovered && paymentLink && (
            <a
              href={paymentLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 py-3 text-sm font-semibold text-[#1c1a16]"
            >
              Click here
              <ExternalLink size={14} />
            </a>
          )}

          {checkoutNote && (
            <p className="mt-4 text-sm text-[#5c584f]">{checkoutNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default CustomerRecover;
