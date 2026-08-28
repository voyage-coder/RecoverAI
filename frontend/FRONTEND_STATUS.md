# RecoverAI Frontend Status

**Scope:** Inspection only of `frontend/`.  
**No packages installed. No frontend or backend code changed.**

---

## 1. Current frontend framework and dependencies

| Layer | Choice |
|-------|--------|
| UI library | **React 19** (`react`, `react-dom` ^19.2.x) |
| Build tool | **Vite 8** (`@vitejs/plugin-react`) |
| Routing | **react-router-dom** ^7 |
| HTTP | **axios** ^1.19 |
| Icons | **lucide-react** |
| Styling | **Tailwind CSS 3.4** + PostCSS + Autoprefixer |
| Lint | **oxlint** |
| Language | **JavaScript / JSX** (not TypeScript app code; `@types/react*` present for tooling) |

**Scripts (`package.json`):**
- `npm run dev` — Vite dev server
- `npm run build` — production build
- `npm run preview` — preview build
- `npm run lint` — oxlint

**Not present:** Redux/Zustand, React Query, chart libraries (Recharts/Chart.js), UI kits (MUI/Chakra), auth libraries, test runners.

---

## 2. Existing pages

| Page | File | Route | Role |
|------|------|-------|------|
| Dashboard | `src/pages/Dashboard.jsx` | `/` | Ops overview, stats, charts, activity slice |
| Recovery Cases | `src/pages/RecoveryCases.jsx` | `/cases` | Searchable/filterable case list |
| Case Details | `src/pages/CaseDetails.jsx` | `/cases/:caseId` | Case header, result, timeline, strategies/actions |
| Analytics | `src/pages/Analytics.jsx` | `/analytics` | Overview stats + failure distribution |
| Activity | `src/pages/Activity.jsx` | `/activity` | Recent case updates feed |
| Settings | `src/pages/Settings.jsx` | `/settings` | **Placeholder only** |

---

## 3. Existing components

| Component | File | Purpose |
|-----------|------|---------|
| `Layout` | `components/Layout.jsx` | Shell: sidebar + topbar + `<Outlet />` |
| `Sidebar` | `components/Sidebar.jsx` | Brand + nav + “Live desk” status card; mobile drawer |
| `Topbar` | `components/Topbar.jsx` | Search → `/cases?q=…`, notifications stub, operator chip |
| `StatCard` | `components/StatCard.jsx` | KPI tile with tone variants |
| `StatusBadge` | `components/StatusBadge.jsx` | Enum → colored badge |
| `CaseTable` | `components/CaseTable.jsx` | Desktop table + mobile card list; links to case detail |
| `ActivityFeed` | `components/ActivityFeed.jsx` | Recent activity rows (optional case link) |
| `FailureChart` | `components/FailureChart.jsx` | Horizontal bar chart (CSS, no chart lib) |
| `RecoveryProgress` | `components/RecoveryProgress.jsx` | At-risk / recovered / rate + progress bar |
| `RecoveryTimeline` | `components/RecoveryTimeline.jsx` | Merged chronological events from timeline API |
| `LoadingState` / `ErrorState` / `EmptyState` | `components/LoadingState.jsx` | Shared loading/error/empty UX |

**Utils:**
- `utils/format.js` — `formatINR` (paise→₹), percent, date/time, relative time
- `utils/labels.js` — enum → human labels; status/category/risk constants

**Leftover:** `src/App.css` looks like Vite scaffold CSS and is **not** imported by `main.jsx` (app uses `index.css`).

---

## 4. Existing API integration

**Client:** `src/services/api.js` (axios instance).

**Base URL logic:**
- `VITE_API_URL` if set
- Else in **dev**: `""` (same-origin → Vite proxy)
- Else in **prod**: `http://127.0.0.1:8000`

**Vite proxy (`vite.config.js`):** `/api` → `http://127.0.0.1:8000` (avoids CORS in local dev).

| Export | Method | Endpoint | Used by |
|--------|--------|----------|---------|
| `getDashboardOverview` | GET | `/api/dashboard/overview` | Dashboard, Analytics |
| `getRecentActivity` | GET | `/api/dashboard/recent-activity` | Dashboard, Activity |
| `getFailureCategories` | GET | `/api/dashboard/failure-categories` | Dashboard, Analytics |
| `getRecoveryCases` | GET | `/api/recovery/cases` | Dashboard*, Cases, Activity* |
| `getRecoveryCase` | GET | `/api/recovery/cases/{id}` | Case Details |
| `getCaseTimeline` | GET | `/api/recovery/cases/{id}/timeline` | Case Details |
| `runPaymentRecovery` | POST | `/api/recovery/payments/{id}/run` | **Defined but unused in pages** |

\*Cases list is also fetched on Dashboard/Activity to map `case_number` → `case_id` for deep links (API activity payload lacks `case_id`).

**Not integrated in UI:** webhooks, Razorpay status, customer/payment detail APIs (none exist), LLM/ML health, auth.

---

## 5. Existing routing

Defined in `src/App.jsx` with `BrowserRouter`:

```
Layout
  /                 → Dashboard
  /cases            → RecoveryCases
  /cases/:caseId    → CaseDetails   (caseId = RecoveryCase.id)
  /analytics        → Analytics
  /activity         → Activity
  /settings         → Settings
  *                 → Navigate to /
```

**Notes:**
- Nested under shared `Layout` (sidebar + topbar).
- Case detail uses **UUID `id`**, not `case_number`.
- Topbar search navigates to `/cases?q=…` (client-side filter).
- Cases page syncs filters to URL query: `q`, `status`, `category`, `risk`, `sort`.

---

## 6. Existing dashboard UI

**Implemented:**
- Dark ink hero with brand copy + CTA to cases
- Hero mini-metrics: at risk, recovered, rate, total cases
- Two `StatCard` rows: totals + pipeline status (active / in progress / recovered / escalated)
- Recovery Performance panel (`RecoveryProgress`)
- Failure Analytics panel (`FailureChart`) + link to Analytics
- Recent Activity panel (`ActivityFeed`, first 6) + link to Activity
- Loading / error states

**Data:** Live from dashboard + failure + activity + cases APIs.

---

## 7. Existing case UI

### List (`/cases`)
- Client-side search, status/category/risk filters, sort
- URL-synced query params
- `CaseTable` with link to `/cases/{id}`
- Responsive: table on `md+`, cards on mobile

### Detail (`/cases/:caseId`)
- Hero with case number, failure reason, status/risk badges
- Metrics: amount at risk, recovery probability, AI confidence, current step
- Detail grid: category, root cause, strategy, retry/contact counts, timestamps, payment/customer IDs
- Recovery Result section (from timeline)
- `RecoveryTimeline` (strategies, actions, communications, result, audit)
- Separate Strategies + Actions cards

**Missing on case UI (by design / API gaps):**
- Customer name/email/phone (only IDs)
- Payment attempts / Razorpay order IDs
- Communications-only inbox view
- Manual “run recovery” / execute action controls
- Real-time refresh / polling

---

## 8. Existing charts

| Chart | Component | Tech | Data |
|-------|-----------|------|------|
| Failure distribution | `FailureChart` | Custom CSS bar rows | `getFailureCategories` |
| Recovery performance | `RecoveryProgress` | Custom progress bar + KPI tiles | overview amounts/rate |

**No third-party chart library.** Analytics page reuses the same overview stats + `FailureChart` / `RecoveryProgress` patterns.

---

## 9. Existing styling / design system

**Theme name (informal):** light “Quiet Ledger” / recovery desk — pine accents on mist backgrounds.

**Fonts (Google Fonts in `index.html`):**
- **Manrope** — UI sans (`font-sans`)
- **Newsreader** — display headings (`font-display`)
- **IBM Plex Mono** — amounts / IDs (`font-mono`)

**Tailwind tokens (`tailwind.config.js`):**
- Colors: `ink`, `mist`, `pine`, `clay`, `sand`, `skyline` (+ soft/mid variants)
- Shadows: `panel`, `lift`
- Radius: `panel` (14px)
- Motion: `animate-rise`, `animate-shimmer`

**Global (`index.css`):**
- Light `color-scheme`
- Soft radial gradients + subtle noise overlay on `body`
- Component utilities: `.panel`, `.page-enter`, `.eyebrow`, `.page-title`, `.field`

**Layout patterns:**
- Fixed sidebar (17.5rem) + fixed topbar; main content offset
- `max-w-[1380px]` content column
- Rounded panels (`rounded-[22px]` / `rounded-panel`), restrained borders (`border-ink/10`)

**Not used:** dark mode toggle, purple AI gradients, Inter/Roboto defaults.

---

## 10. What is already implemented

- Full app shell (responsive sidebar + topbar)
- Six routes including catch-all redirect
- Live dashboard wired to backend aggregates
- Cases list with client filters/search/sort + deep links
- Case detail with timeline + strategies/actions/result
- Analytics page on overview + failure categories
- Activity feed with case_id enrichment workaround
- Shared formatting/labels/status badges
- Axios API module aligned with existing FastAPI routes
- Dev proxy for `/api`
- Cohesive design system (tokens, fonts, panels)

---

## 11. What is incomplete

| Area | Status |
|------|--------|
| **Settings** | Placeholder copy only; no auth, notifications, gateway/LLM config |
| **`runPaymentRecovery`** | In `api.js`, not used by any page |
| **Notifications bell** | UI control only; no backend |
| **Operator identity** | Hardcoded “Ops” chip in topbar |
| **Sidebar “Live desk / Synced with API”** | Decorative; not driven by health check |
| **Customer / payment enrichment** | IDs only; no dedicated APIs consumed |
| **PaymentAttempt / Razorpay audit** | Not shown |
| **Server-side pagination/filter** | All cases loaded client-side |
| **Activity `case_id`** | Client join workaround; breaks if case list incomplete |
| **Auth / roles** | None |
| **Webhook / TEST payment ops UI** | None (correctly backend/script territory for now) |
| **Tests** | No frontend test suite in tree |
| **`App.css`** | Unused scaffold remnant |

---

## 12. What should be reused

When extending the frontend, prefer building on:

1. **`services/api.js`** — single axios surface; add helpers here
2. **`Layout` / `Sidebar` / `Topbar`** — do not replace shell
3. **Design tokens** in `tailwind.config.js` + `.panel` / `.page-title` / `.eyebrow`
4. **`format.js` + `labels.js` + `StatusBadge`** — keep money/enum presentation consistent
5. **`LoadingState` / `ErrorState` / `EmptyState`** — same async UX language
6. **`CaseTable`, `ActivityFeed`, `RecoveryTimeline`, `StatCard`, charts** — compose rather than redesign
7. **Vite `/api` proxy** + `VITE_API_URL` pattern
8. **URL query sync on Cases** — pattern for future filters
9. **Client `case_number` → `id` enrichment** until backend adds `case_id` to activity

---

## 13. What should NOT be rewritten

Do **not** throw away or wholesale rewrite:

- The **Quiet Ledger** visual system (Manrope/Newsreader/pine/mist)
- The **admin desk IA**: Dashboard → Cases → Detail → Analytics → Activity → Settings
- Existing **working pages** (Dashboard, Cases, CaseDetails, Analytics, Activity)
- **`api.js` contract** with current FastAPI paths
- Custom **CSS charts** unless a real charting need appears (avoid drive-by Recharts/MUI)
- React + Vite + Tailwind stack
- Case detail’s timeline-centric model (matches backend timeline endpoint)

Prefer **incremental** additions (new sections, settings fields, richer case panels) over a greenfield UI.

---

## Quick architecture map

```
main.jsx → App.jsx (BrowserRouter)
              └── Layout (Sidebar + Topbar)
                    ├── Dashboard      → overview + failures + activity + cases
                    ├── RecoveryCases  → cases (+ client filters)
                    ├── CaseDetails    → case + timeline
                    ├── Analytics      → overview + failures
                    ├── Activity       → activity + cases (id map)
                    └── Settings       → placeholder
```

---

## Summary

The RecoverAI frontend is a **working React 19 + Vite + Tailwind ops console** already integrated with the current dashboard and recovery APIs. Design system and core case/dashboard flows are production-shaped for a demo. Gaps are mostly **Settings**, **ops actions** (`runPaymentRecovery`), **entity enrichment** (customer/payment/attempts), and **backend API limits** — not a missing app shell.
