# RecoverAI Backend API Inventory

**Purpose:** Frontend integration reference.  
**Generated from:** `backend/app/routes/`, `backend/app/main.py`, `backend/app/api_schemas.py`, `backend/app/schema.py`, `backend/app/services/`  
**Status:** Documentation only — no endpoints were added or changed.

**Auth summary:** No application-level authentication (no JWT, API keys, or session auth) on any RecoverAI REST endpoint today. The Razorpay webhook requires a verified `X-Razorpay-Signature` (gateway trust, not user auth).

**Amounts:** Monetary fields are integers in **paise** (₹1 = 100).

**OpenAPI:** FastAPI also exposes interactive docs at `/docs` and `/openapi.json` (framework defaults; not product APIs).

---

## Endpoint index

| Group | Method | URL | Mutates? |
|-------|--------|-----|----------|
| System | `GET` | `/` | No |
| System | `GET` | `/health` | No |
| Recovery Cases | `GET` | `/api/recovery/cases` | No |
| Recovery Cases | `GET` | `/api/recovery/cases/{case_id}` | No |
| Recovery Cases | `GET` | `/api/recovery/cases/{case_id}/timeline` | No |
| Payments | `POST` | `/api/recovery/payments/{payment_id}/run` | Yes |
| Dashboard/Statistics | `GET` | `/api/dashboard/overview` | No |
| Dashboard/Statistics | `GET` | `/api/dashboard/recent-activity` | No |
| Dashboard/Statistics | `GET` | `/api/dashboard/failure-categories` | No |
| Razorpay/Webhooks | `POST` | `/api/webhooks/razorpay` | Yes (conditional) |

**Standalone HTTP groups with no dedicated routes today:** Recovery Results, Strategies, Actions, Communications, ML/AI (all available only nested under case timeline or via internal services).

---

## System

### `GET /`

| Field | Detail |
|-------|--------|
| **Request** | None |
| **Response** | `{ "message": "RecoverAI API is running" }` |
| **Auth** | None |
| **Entities** | None |
| **Mutates** | Read-only |

### `GET /health`

| Field | Detail |
|-------|--------|
| **Request** | None |
| **Response** | `{ "status": "healthy" }` |
| **Auth** | None |
| **Entities** | None |
| **Mutates** | Read-only |

---

## Recovery Cases

### `GET /api/recovery/cases`

List all recovery cases (newest first).

| Field | Detail |
|-------|--------|
| **Request body** | None |
| **Query params** | None (no pagination, filter, or search) |
| **Response** | `RecoveryCaseListResponse[]` |
| **Auth** | None |
| **Entities** | `RecoveryCase` |
| **Mutates** | Read-only |

**Response item (`RecoveryCaseListResponse`):**

```json
{
  "id": "string",
  "case_number": "string",
  "amount_at_risk": 0,
  "status": "ACTIVE|IN_PROGRESS|RECOVERED|ESCALATED|CLOSED",
  "failure_category": "string",
  "recovery_probability": 0,
  "risk_level": "string",
  "selected_strategy": "string|null",
  "current_step": "string",
  "created_at": "ISO-8601 datetime"
}
```

**Frontend usage:** Cases list page (`getRecoveryCases`).

---

### `GET /api/recovery/cases/{case_id}`

Fetch a single recovery case by primary key `id` (not `case_number`).

| Field | Detail |
|-------|--------|
| **Path** | `case_id` — `RecoveryCase.id` |
| **Request body** | None |
| **Response** | `RecoveryCaseResponse` |
| **Errors** | `404` — `"Recovery case not found."` |
| **Auth** | None |
| **Entities** | `RecoveryCase` |
| **Mutates** | Read-only |

**Response (`RecoveryCaseResponse`):**

```json
{
  "id": "string",
  "case_number": "string",
  "payment_id": "string",
  "customer_id": "string",
  "amount_at_risk": 0,
  "status": "string",
  "failure_category": "string",
  "failure_reason": "string",
  "root_cause": "string|null",
  "recovery_probability": 0,
  "ai_confidence": 0,
  "risk_level": "string",
  "selected_strategy": "string|null",
  "current_step": "string",
  "retry_count": 0,
  "contact_count": 0,
  "created_at": "ISO-8601 datetime",
  "updated_at": "ISO-8601 datetime"
}
```

**Notes for frontend:**
- Returns `customer_id` / `payment_id` only — **no embedded customer or payment objects**.
- Lookup by `case_number` (e.g. `RC-000013`) is **not** supported; use `id`.

**Frontend usage:** Case details (`getRecoveryCase`).

---

### `GET /api/recovery/cases/{case_id}/timeline`

Aggregate case timeline: strategies, actions, communications, result, audit logs.

| Field | Detail |
|-------|--------|
| **Path** | `case_id` — `RecoveryCase.id` |
| **Request body** | None |
| **Response** | `RecoveryTimelineResponse` |
| **Errors** | `404` — `"Recovery case not found."` |
| **Auth** | None |
| **Entities** | `RecoveryCase`, `RecoveryStrategy`, `RecoveryAction`, `Communication`, `RecoveryResult`, `AuditLog` |
| **Mutates** | Read-only |

**Response shape:**

```json
{
  "case": { /* RecoveryCaseResponse */ },
  "strategies": [ /* RecoveryStrategyResponse */ ],
  "actions": [ /* RecoveryActionResponse */ ],
  "communications": [ /* CommunicationResponse */ ],
  "result": { /* RecoveryResultResponse */ } | null,
  "audit_logs": [ /* AuditLogResponse */ ]
}
```

**Nested types:**

`RecoveryStrategyResponse`

```json
{
  "id": "string",
  "case_id": "string",
  "strategy_type": "string",
  "rationale": "string",
  "expected_probability": 0,
  "stopping_rules": "string|null",
  "is_selected": true,
  "created_at": "ISO-8601 datetime"
}
```

`RecoveryActionResponse`

```json
{
  "id": "string",
  "case_id": "string",
  "action_type": "string",
  "status": "PENDING|PROCESSING|EXECUTED|FAILED|BLOCKED",
  "attempt_number": 0,
  "scheduled_at": "ISO-8601|null",
  "executed_at": "ISO-8601|null",
  "result_text": "string|null",
  "created_at": "ISO-8601 datetime"
}
```

`CommunicationResponse`

```json
{
  "id": "string",
  "case_id": "string",
  "channel": "EMAIL|SMS|WHATSAPP",
  "direction": "OUTBOUND|INBOUND",
  "content": "string",
  "status": "string",
  "sent_at": "ISO-8601 datetime"
}
```

`RecoveryResultResponse`

```json
{
  "id": "string",
  "case_id": "string",
  "original_amount": 0,
  "recovered_amount": 0,
  "status": "PENDING|PARTIALLY_RECOVERED|FULLY_RECOVERED|NOT_RECOVERED",
  "recovery_method": "string|null",
  "recovered_at": "ISO-8601|null",
  "created_at": "ISO-8601 datetime"
}
```

`AuditLogResponse`

```json
{
  "id": "string",
  "case_id": "string|null",
  "action_type": "string",
  "actor": "string",
  "details": "string",
  "timestamp": "ISO-8601 datetime"
}
```

**Not included in timeline (gaps):**
- `Payment` / `PaymentAttempt` / Razorpay order IDs
- `Customer` profile
- `CustomerResponse` / `PromiseToPay`
- `Order` / `Product`

**Frontend usage:** Case details timeline (`getCaseTimeline`).

---

## Payments

### `POST /api/recovery/payments/{payment_id}/run`

Start (or continue) the recovery orchestrator for a failed payment.

| Field | Detail |
|-------|--------|
| **Path** | `payment_id` — `Payment.id` |
| **Request body** | None |
| **Query params** | None |
| **Auth** | None |
| **Entities** | Reads `Payment`; may create/update `RecoveryCase` and downstream recovery entities via `process_payment` (diagnosis, strategies, actions, results, audit, etc.) |
| **Mutates** | **Yes** (`db.commit()`) |

**Success responses:**

```json
{
  "message": "Recovery workflow started.",
  "case_id": "string",
  "case_number": "string",
  "status": "CaseStatus"
}
```

or

```json
{
  "message": "Recovery case already completed."
}
```

**Errors:**
- `404` — `"Payment not found."`
- `400` — `"Only failed payments can enter recovery."` (when `payment.status != "FAILED"`)

**Notes:**
- There is **no** `GET /api/.../payments` list or detail endpoint.
- Frontend must already know `payment_id` to call this.

**Frontend usage:** Wired in `api.js` as `runPaymentRecovery`; not necessarily exposed as a primary UI control today.

---

## Recovery Results

**No dedicated REST endpoints.**

| How available | Via |
|---------------|-----|
| Single case result | Nested in `GET /api/recovery/cases/{case_id}/timeline` → `result` |
| Aggregate recovered amount | `GET /api/dashboard/overview` → `amount_recovered` |

**No:** list results, filter by `FULLY_RECOVERED`, get-by-id, or manual result update API.

---

## Strategies

**No dedicated REST endpoints.**

| How available | Via |
|---------------|-----|
| Per-case strategies | Timeline → `strategies` |

**No:** list all strategies, re-rank, select/override strategy, or ML score breakdown API.

Strategy creation/ranking happens inside services (`strategy_service`, `safe_strategy_selector`, orchestrator / recovery loop) — not exposed as HTTP.

---

## Actions

**No dedicated REST endpoints.**

| How available | Via |
|---------------|-----|
| Per-case actions | Timeline → `actions` |

**No:** execute action manually, cancel/block action, list pending actions globally, or poll action status by id.

Action execution is internal (`executor_service`, recovery loop).

---

## Communications

**No dedicated REST endpoints.**

| How available | Via |
|---------------|-----|
| Per-case messages | Timeline → `communications` |

**No:** send message manually, list inbox, inbound reply ingest API, or template management.

LLM drafting (`llm_service`) and send simulation run inside the executor only.

---

## Razorpay / Webhooks

### `POST /api/webhooks/razorpay`

Razorpay TEST MODE webhook receiver. **Not a frontend API** — called by Razorpay (or a tunnel).

| Field | Detail |
|-------|--------|
| **Headers** | `X-Razorpay-Signature` (required for acceptance); `Content-Type: application/json` |
| **Body** | **Raw** Razorpay event JSON (must not be re-serialized before verification) |
| **Auth** | Signature verification with `RAZORPAY_WEBHOOK_SECRET` (not user auth) |
| **Entities** | May update `Payment`, `Order`, `PaymentAttempt`, `RecoveryCase`, `RecoveryResult`, `RecoveryAction` when matched + verified success |
| **Mutates** | **Yes** only when `modified=True` (then `commit`); otherwise `rollback` |

**Success / ack JSON (HTTP 200):**

```json
{
  "status": "recovered|idempotent|unmatched|ignored|skipped_escalated|...",
  "detail": "string",
  "event": "string|null",
  "idempotent": false,
  "case_id": "string|null",
  "payment_id": "string|null"
}
```

**Error JSON:**
- `401` — `invalid_signature` / `missing_signature`
- `503` — `misconfigured` (webhook secret missing)
- `400` — other rejected payloads (e.g. invalid JSON)

**Supported recovery events (service layer):** `payment.captured`, `payment_link.paid`.  
Unknown / non-success events are acknowledged without recovery.

**No frontend endpoints for:**
- Creating Razorpay orders/links
- PaymentAttempt history
- Gateway mode (`RAZORPAY_TEST` vs `SIMULATED_GATEWAY`)
- Checkout helpers

Order/link creation is internal (`payment_gateway_service` + executor) or scripts (e.g. `create_real_razorpay_test_order.py`).

---

## ML / AI

**No dedicated REST endpoints.**

| Capability | Where it runs | HTTP? |
|------------|---------------|-------|
| Feature building | `feature_service` | No |
| Recovery probability model | `recovery_predictor` | No |
| Strategy ranking | `strategy_ranker` / `safe_strategy_selector` | No |
| Safety Engine | `safety_service` | No |
| Gemini customer copy | `llm_service` (executor communications only) | No |

**Exposed indirectly:**
- Case fields: `recovery_probability`, `ai_confidence`, `risk_level`, `selected_strategy`, `root_cause`
- Timeline `strategies[].expected_probability` / `rationale`

**No:** model metrics, feature vector dump, LLM prompt/debug, “re-run ML” button API, Gemini health check API.

---

## Dashboard / Statistics

### `GET /api/dashboard/overview`

Aggregate case and recovery money stats.

| Field | Detail |
|-------|--------|
| **Request** | None |
| **Auth** | None |
| **Entities** | Aggregates `RecoveryCase`, `RecoveryResult` |
| **Mutates** | Read-only |

**Response:**

```json
{
  "total_cases": 0,
  "active_cases": 0,
  "in_progress_cases": 0,
  "recovered_cases": 0,
  "escalated_cases": 0,
  "closed_cases": 0,
  "amount_at_risk": 0,
  "amount_recovered": 0,
  "recovery_rate": 0.0
}
```

**Notes:**
- `amount_at_risk` = sum of **all** cases’ `amount_at_risk` (not only open cases).
- `amount_recovered` = sum of all `RecoveryResult.recovered_amount`.
- `recovery_rate` = `(amount_recovered / amount_at_risk) * 100` rounded to 2 decimals (0 if no risk amount).

**Frontend usage:** Dashboard + Analytics.

---

### `GET /api/dashboard/recent-activity`

Latest 10 case updates (hard-coded limit).

| Field | Detail |
|-------|--------|
| **Request** | None (no `limit` query param) |
| **Auth** | None |
| **Entities** | `RecoveryCase` |
| **Mutates** | Read-only |

**Response:**

```json
[
  {
    "case_number": "string",
    "current_step": "string",
    "status": "CaseStatus",
    "updated_at": "ISO-8601 datetime"
  }
]
```

**Gap:** Returns `case_number` but **not** `case_id`, so Activity UI cannot deep-link by id without another lookup.

**Frontend usage:** Activity feed / dashboard activity.

---

### `GET /api/dashboard/failure-categories`

Case counts grouped by `failure_category`.

| Field | Detail |
|-------|--------|
| **Request** | None |
| **Auth** | None |
| **Entities** | `RecoveryCase` |
| **Mutates** | Read-only |

**Response:**

```json
[
  {
    "category": "INSUFFICIENT_FUNDS|CARD_DECLINED|EXPIRED_CARD|GATEWAY_TIMEOUT|TECHNICAL_FAILURE|AUTHENTICATION_FAILED",
    "count": 0
  }
]
```

**Frontend usage:** Analytics failure chart.

---

## Frontend data with NO API endpoint (important gaps)

These exist in the schema/services (or are useful for UI) but have **no dedicated HTTP surface** today:

| Data / capability | Why it matters for frontend | Current workaround |
|-------------------|-----------------------------|--------------------|
| **Customer** (name, email, phone, risk_tier, payment_history_score) | Case detail “who is this?” | Only `customer_id` on case |
| **Payment** detail (amount, currency, failure_code/reason, status) | Payment context on case page | Only `payment_id`; failure text partly on case |
| **PaymentAttempt** list + `gateway_response` (Razorpay `order_id`, awaiting webhook) | Show retry / gateway audit trail | None |
| **Order** / **Product** | Commerce context | None |
| **CustomerResponse** / intent | Inbound reply UX | None |
| **PromiseToPay** | PTP tracking UI | None |
| Lookup case by **`case_number`** | Operator search / Activity deep-link | Only by `id` |
| **Cases filter/search/pagination** | Large case lists | Full list only |
| Global **pending actions** queue | Operator work queue | Timeline per case only |
| Manual **run next recovery step** / execute action | Ops controls | Internal loop only; payment `run` is entrypoint |
| **Razorpay / gateway status** (TEST vs SIMULATED, webhook health) | Settings / ops | Settings page is placeholder |
| **LLM / Gemini status** | Settings / comms health | None |
| **ML model info** (version, features used) | Analytics transparency | Indirect scores on case only |
| **Audit log** feed (global) | Compliance / Activity richness | Per-case timeline only |
| **Auth / operator identity** | Settings promises auth later | No auth APIs |
| Activity items with **`case_id`** | Click-through from recent activity | `case_number` only |
| List **failed payments** eligible for recovery | “Start recovery” UX | Must know `payment_id` already |

---

## Entity → API coverage matrix

| Entity | List | Get | Create/Update via API |
|--------|------|-----|------------------------|
| RecoveryCase | Yes | Yes | Indirect (`POST .../payments/{id}/run`, webhook) |
| RecoveryStrategy | Via timeline | — | Internal only |
| RecoveryAction | Via timeline | — | Internal only |
| RecoveryResult | Via timeline / dashboard sum | — | Internal + webhook |
| Communication | Via timeline | — | Internal only |
| AuditLog | Via timeline | — | Internal only |
| Payment | — | — | Run recovery only |
| PaymentAttempt | — | — | Internal + webhook |
| Customer | — | — | — |
| Order / Product | — | — | Webhook may set order status |
| CustomerResponse / PromiseToPay | — | — | — |

---

## Frontend client map (`frontend/src/services/api.js`)

| Client helper | Endpoint |
|---------------|----------|
| `getDashboardOverview` | `GET /api/dashboard/overview` |
| `getRecentActivity` | `GET /api/dashboard/recent-activity` |
| `getFailureCategories` | `GET /api/dashboard/failure-categories` |
| `getRecoveryCases` | `GET /api/recovery/cases` |
| `getRecoveryCase` | `GET /api/recovery/cases/{caseId}` |
| `getCaseTimeline` | `GET /api/recovery/cases/{caseId}/timeline` |
| `runPaymentRecovery` | `POST /api/recovery/payments/{paymentId}/run` |

Webhook endpoint is intentionally **not** called from the frontend.

---

## Integration notes

1. **No CORS middleware** is registered in `main.py`. Local Vite proxy (or same-origin) is required unless CORS is added later.
2. **No pagination** on case list or activity.
3. **Enums** serialize as strings in JSON responses.
4. **Webhook** must never be treated as a browser “payment success” callback; recovery requires verified Razorpay events and RecoverAI ID matching.
5. Creating endpoints for the gaps above is **out of scope for this inventory** — document only.
