# Himma Finance Case

Personal finance dashboard built around the supplied take-home dataset. The app shows a transaction table, spending summaries, category and monthly breakdowns, recurring merchants, product-style insights, and a natural-language Q&A backed by an LLM that cites the transactions it used.

## Demo

<!-- TODO: replace with a live link, screenshot, or short clip -->

_Demo placeholder — add a screenshot, GIF, or hosted URL here._

## Setup (under 2 minutes)

Requires **Node 20+** (uses ES2022 features).

```bash
npm install
cp .env.example .env.local   # then edit .env.local — see below
npm run dev
```

Open `http://localhost:3000`.

The dashboard, charts, filters, and transactions table work **without any setup** — the dataset is local. To enable the AI Q&A widget (bottom-right), add an OpenAI key to `.env.local`:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini   # optional, this is the default
```

I tried a keyless fallback (community-hosted DeepSeek R1 1.5B) so reviewers could try the AI without setting up a key, but the model was too small to handle the full dataset reliably — it would invent totals, drop matching transactions, and confuse Transfer with non-Transfer categories. Bad answers from a "demo" mode were worse than no answers, so I removed it. If you don't set the key, the chat widget shows a clear setup hint instead of failing silently.

## Scripts

```bash
npm run dev      # local dev server
npm run build    # production build
npm run lint     # eslint (next/core-web-vitals)
npm test         # node --test on .mjs and .ts (via tsx)
```

## What I Built

The product focuses on the questions a user actually asks after connecting a bank account: where did money go, what changed month-to-month, which merchants repeat, and is something distorting the picture. The dataset is dominated by a recurring `Transfer to Savings` of 3,000 AED/month, so the dashboard treats transfers as a separate concept rather than mixing them into "spend":

- **Headline metrics** show total outflow, daily spend (excluding transfers), the top non-transfer category, and a live "filtered total" that reacts to the table filters.
- **Spend by category** with horizontal bars (Transfer kept visible but coloured separately so it's easy to discount).
- **Monthly trend** to surface the March spike.
- **Insights** panel: top non-transfer category, highest month, largest single transaction, savings transfer share if >25%, recurring merchant count.
- **Recurring merchants** (≥3 occurrences) with average and total.
- **AI Q&A as a conversation**: multi-turn — follow-ups like "and the month before?" reuse the prior context. Each assistant turn renders the cited transactions inline (date, merchant, category, amount), not just IDs. A "Clear conversation" link resets the thread.

The backend exposes three deterministic-or-AI routes:

- `GET /api/transactions?month=&category=&search=&includeTransfers=` — filtered list.
- `GET /api/summary` — full summary with categories, months, recurring merchants and insights.
- `POST /api/ask` `{ history: [{ role, content }, ...] }` (or `{ question }` for the legacy single-turn path) — LLM answer with `answer`, `supportingFacts[]`, `matchedTransactions[]`. The route validates the model output, drops any transaction id the model invented, deduplicates, and caps the citation list. The dataset is sent only in the first user turn — follow-ups are plain text — to avoid re-paying the ~10 KB envelope on every turn.

## Trade-offs

- **No database.** Data is loaded from `data/transactions.json` (a copy of the supplied `sample-transactions.json`). The brief explicitly mocks bank connectivity and prioritises product judgment over plumbing.
- **CSS charts, not a vis library.** Chart.js / Recharts would add 60–120 KB and configuration noise for two charts that fit on a back-of-the-envelope. CSS bars render instantly and stay accessible.
- **Headline metrics are dataset-wide; only "Filtered total" reacts to the table filters.** Mixing the two would mean every tile flickers on each keystroke and you'd lose the "all-up baseline" anchor. This is a deliberate split, called out in the tile labels.
- **Non-streaming AI response.** I prioritised making the answer trustworthy (validated JSON, citation rendering, error states, 30 s timeout) over streaming text token-by-token. The trade-off is that the user waits a few seconds; partial-JSON streaming is the next step (see below).
- **No auth, no real bank API, no deployment work** — per the brief.

## Prompt Strategy

The system prompt instructs the model to:

1. Answer **only** from the supplied dataset; never invent merchants, dates, categories, totals, or accounts.
2. Always include AED.
3. Treat `Transfer` rows as savings movements, not consumption — and call out whether transfers are included.
4. If the question is outside the dataset's date range or unanswerable, say so plainly.
5. Cite the supporting transaction ids in `matchedTransactions`, capped at 25.
6. Return JSON only.

The user message is JSON-serialized for unambiguous parsing and contains: the output schema, the dataset metadata (currency, date range, category list), precomputed aggregates (monthly and category totals, total spend, total spend excluding transfers), and a compacted transaction list (id, date, merchant, amount, category — `currency` and `account` dropped because they're constant). Precomputed aggregates reduce arithmetic risk for "how much did I spend on X" questions, while the raw rows let the model cite specific transactions for narrower or anomaly-style questions.

On the response side: `response_format: json_object`, `temperature: 0.1`, JSON re-parsed and normalized server-side, and any `matchedTransactions` id that doesn't exist in the dataset is dropped before returning. This kills the most common LLM failure mode — confidently citing a fabricated id.

## Tests

`npm test` runs two suites:

- `test/transactions.test.mjs` — sanity asserts on the raw dataset (totals, date range, monthly spike).
- `test/summarize.test.ts` — exercises the actual library code: `summarizeTransactions` totals, ranking, monthly aggregation, recurring merchants, and `filterTransactions` for month/category/search/transfers.

The TypeScript test runs through `tsx` so `node --test` can import the same modules the app does without a separate build.

## With Another 3 Hours

1. **Tool use for filter + math (top priority).** Replace "send the whole dataset, hope the LLM scans it correctly" with function calling. Expose two tools:
   - `filterTransactions({ merchant?, category?, dateFrom?, dateTo? }) → { ids, count, total }` — deterministic filter, returns the full and exact match set.
   - `sumAmounts({ ids }) → { total, breakdownByCategory, breakdownByMonth }` — deterministic arithmetic.

   The model picks tools, server runs them, model only narrates. This kills the two failure modes I still see today: (a) the model occasionally drops a matching transaction when scanning ~100 rows ("show me all Lulu" missed the Feb 16 row), and (b) stated totals can disagree with the cited list. With tools the cited list IS the filter output and the total IS the tool result — no LLM arithmetic, no LLM enumeration. The current prompt and pre-built `merchantIndex` reduce these errors but don't eliminate them; tool use does.
2. **Streaming answers.** Stream the LLM response with a tolerant partial-JSON parser so the `answer` field renders progressively.
3. **Deterministic pre-parser.** Sits in front of the LLM. Cheap intent classifier ("how much in <month> on <category>") that answers from precomputed totals and only escalates to the LLM for free-form questions. Same end goal as tool use — exact math — but for the trivial cases.
4. **History persistence.** Multi-turn already works in-session; persist the thread in `localStorage` so a refresh doesn't lose context.
5. **Eval suite.** A handful of golden questions with expected ranges (e.g. "March dining is 11xx ± 5%") run on every PR. Concretely catches the regressions above.
6. **Budget targets** + month-over-month deltas in insights.
7. **Anomaly detection** ("Spotify charged 89 AED, 3× the usual 29.99").
