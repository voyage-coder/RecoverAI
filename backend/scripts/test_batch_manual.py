"""Quick manual batch ingestion test (5 events)."""
import json
import uuid
import urllib.request

BASE = "http://127.0.0.1:8000"


def post(data):
    req = urllib.request.Request(
        f"{BASE}/api/events/payment",
        data=json.dumps(data).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    return json.loads(urllib.request.urlopen(req).read())


def get(url):
    return json.loads(urllib.request.urlopen(url).read())


def main():
    batch_id = str(uuid.uuid4())
    scenarios = [
        ("GATEWAY_TIMEOUT", "Gateway timeout"),
        ("INSUFFICIENT_FUNDS", "Insufficient funds"),
        ("CARD_DECLINED", "Card declined"),
        ("NETWORK_ERROR", "Network error"),
        ("BANK_SERVER_ERROR", "Bank server unavailable"),
    ]
    case_ids = []
    for i, (code, reason) in enumerate(scenarios):
        amount = (500 + i * 400) * 100
        r = post(
            {
                "event": "payment.failed",
                "amount": amount,
                "currency": "INR",
                "customer": {
                    "name": f"Batch User {i}",
                    "email": f"batch.{batch_id[:8]}.{i}@recoverai.demo",
                },
                "failure": {"code": code, "reason": reason},
                "idempotency_key": f"batch-{batch_id}-{i}",
            }
        )
        case_ids.append(r["case_id"])
        print(i + 1, r["case_number"], r["case_status"], amount)

    cases = get(f"{BASE}/api/recovery/cases")
    batch_cases = [c for c in cases if c["id"] in case_ids]
    at_risk = sum(c["amount_at_risk"] for c in batch_cases)
    recovered = 0
    for cid in case_ids:
        t = get(f"{BASE}/api/recovery/cases/{cid}/timeline")
        if t.get("result"):
            recovered += t["result"].get("recovered_amount", 0)

    overview = get(f"{BASE}/api/dashboard/overview")
    rate = round(recovered / at_risk * 100, 2) if at_risk else 0
    print("BATCH_ID", batch_id)
    print("CASES", len(case_ids), "AT_RISK_PAISE", at_risk, "RECOVERED_PAISE", recovered)
    print("RATE_PCT", rate)
    print("OVERVIEW_CASES", overview["total_cases"])
    print("PASS", len(case_ids) == 5 and at_risk > 0)


if __name__ == "__main__":
    main()
