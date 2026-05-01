import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { NextRequest, NextResponse } from "next/server";
import { categories, summarizeTransactions, transactions } from "@/lib/transactions";

const MAX_QUESTION_LENGTH = 500;
const MAX_SUPPORTING_FACTS = 8;
const MAX_MATCHED_TRANSACTIONS = 25;
const MAX_HISTORY_TURNS = 20;

const SYSTEM_PROMPT = `You are a careful personal finance analyst answering questions about a single user's checking account.

Rules:
- Answer ONLY from the supplied transaction dataset. Never invent merchants, dates, categories, totals, or accounts.
- All amounts are in AED. Always include the currency.
- "Transfer" transactions are savings movements, not consumption. When the question is about spending, exclude transfers and say so.
- If the question is outside the dataset's date range or refers to data that does not exist, say so plainly and explain what is available.
- If the question is ambiguous, answer the most reasonable interpretation and note the assumption.
- The user may ask follow-up questions. Use the prior conversation for context (e.g. "and the month before?" refers to the previously discussed month).
- Keep supportingFacts short, factual, and grounded in the data (e.g. "Dining in March: 1,210.50 AED across 12 transactions").
- Return valid JSON matching the requested schema. No prose outside JSON.

Filter discipline (CRITICAL):
- A "merchant filter" and a "category filter" are NOT the same thing. "Lulu Hypermarket" is a merchant. "Groceries" is a category. Carrefour, Spinneys, and Lulu are all distinct merchants even though they share the Groceries category — never substitute one for another.
- For merchant queries, use the 'merchantIndex' field in the dataset. It maps every distinct merchant name to the COMPLETE list of transaction ids for that merchant. Find every key whose name contains the user's term (case-insensitive substring match) and UNION the id lists. This is the authoritative source — do not scan the raw transactions array for merchant matches.
- When the user asks about a category, ONLY include transactions whose 'category' field is that exact category.
- When the user asks about a date range, ONLY include transactions whose 'date' falls in that range.
- Multiple filters are AND, not OR: "Lulu in March" means merchant contains "Lulu" AND date starts with "2025-03".

Citation discipline (CRITICAL):
- Cite the transaction ids that directly support your answer in matchedTransactions. Do not list more than ${MAX_MATCHED_TRANSACTIONS} ids.
- Completeness: include EVERY matching transaction. Do not sample or truncate. The dataset is small. Missing one matching transaction is a critical failure.
- Before returning, re-read each id you plan to cite and verify it matches every filter the user requested. If a transaction does not match the merchant, category, or date filter, REMOVE it.
- Arithmetic self-check: after finalising matchedTransactions, recompute count = matchedTransactions.length and total = sum of those transactions' amounts. Any number you state in answer or supportingFacts MUST equal these recomputed values. If they don't agree, fix the numbers — never invent a total.`;

type HistoryTurn = { role: "user" | "assistant"; content: string };

type AskRequest = {
  question?: string;
  history?: HistoryTurn[];
};

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as AskRequest | null;

  const history = normalizeHistory(body);
  if ("error" in history) {
    return NextResponse.json({ error: history.error }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        answer:
          "AI Q&A is not configured. Add OPENAI_API_KEY to .env.local and restart the dev server. The dashboard, charts, and filters all work without it.",
        supportingFacts: [],
        matchedTransactions: []
      },
      { status: 200 }
    );
  }

  const summary = summarizeTransactions(transactions);
  const knownTransactionIds = new Set(transactions.map((row) => row.id));

  const compactTransactions = transactions.map((row) => ({
    id: row.id,
    date: row.date,
    merchant: row.merchant,
    amount: row.amount,
    category: row.category
  }));

  const merchantIndex: Record<string, string[]> = {};
  for (const row of transactions) {
    (merchantIndex[row.merchant] ??= []).push(row.id);
  }

  const messages = buildMessages(history.turns, summary, compactTransactions, merchantIndex);

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages
    });

    const content = completion.choices[0]?.message.content;
    if (!content) {
      return errorResponse("The model returned an empty response. Please try again.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return errorResponse("The model returned malformed JSON. Please try again.");
    }

    return NextResponse.json(normalizeAnswer(parsed, knownTransactionIds));
  } catch (error) {
    console.error("[/api/ask]", error);
    const message = error instanceof Error ? error.message : "Unknown error.";
    return errorResponse(`AI query failed: ${message}`);
  }
}

function normalizeHistory(body: AskRequest | null): { turns: HistoryTurn[] } | { error: string } {
  if (body && Array.isArray(body.history) && body.history.length > 0) {
    const cleaned: HistoryTurn[] = [];
    for (const turn of body.history) {
      if (!turn || (turn.role !== "user" && turn.role !== "assistant")) {
        return { error: "Invalid history turn role." };
      }
      if (typeof turn.content !== "string" || turn.content.trim().length === 0) {
        return { error: "History turns must have non-empty content." };
      }
      cleaned.push({ role: turn.role, content: turn.content.trim() });
    }
    if (cleaned.length > MAX_HISTORY_TURNS) {
      return { error: `Conversation too long (max ${MAX_HISTORY_TURNS} turns).` };
    }
    if (cleaned[cleaned.length - 1].role !== "user") {
      return { error: "Last history turn must be from the user." };
    }
    const lastUser = cleaned[cleaned.length - 1].content;
    if (lastUser.length > MAX_QUESTION_LENGTH) {
      return { error: `Question is too long (max ${MAX_QUESTION_LENGTH} characters).` };
    }
    return { turns: cleaned };
  }

  // Fallback: single-turn { question }
  const question = body?.question?.trim();
  if (!question) {
    return { error: "Question is required." };
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return { error: `Question is too long (max ${MAX_QUESTION_LENGTH} characters).` };
  }
  return { turns: [{ role: "user", content: question }] };
}

function buildMessages(
  history: HistoryTurn[],
  summary: ReturnType<typeof summarizeTransactions>,
  compactTransactions: Array<{ id: string; date: string; merchant: string; amount: number; category: string }>,
  merchantIndex: Record<string, string[]>
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [{ role: "system", content: SYSTEM_PROMPT }];

  let firstUserSeen = false;
  for (const turn of history) {
    if (turn.role === "user" && !firstUserSeen) {
      firstUserSeen = true;
      messages.push({
        role: "user",
        content: JSON.stringify({
          task: "Answer the user's question about their spending. Future user turns are follow-ups in the same conversation.",
          outputSchema: {
            answer: "string — concise natural language answer (1–3 sentences)",
            supportingFacts: ["string — short factual bullet, max 8"],
            matchedTransactions: ["string — transaction id from the dataset"]
          },
          dataset: {
            currency: summary.currency,
            dateRange: summary.dateRange,
            categories,
            monthlyTotals: summary.months,
            categoryTotals: summary.categories,
            totalSpend: summary.totalSpend,
            totalSpendExcludingTransfers: summary.totalSpendExcludingTransfers,
            merchantIndex,
            transactions: compactTransactions
          },
          question: turn.content
        })
      });
    } else {
      messages.push({ role: turn.role, content: turn.content });
    }
  }

  return messages;
}

function normalizeAnswer(raw: unknown, knownIds: Set<string>) {
  const value = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  const answer =
    typeof value.answer === "string" && value.answer.trim().length > 0
      ? value.answer.trim()
      : "I could not produce an answer from the dataset.";

  const supportingFacts = Array.isArray(value.supportingFacts)
    ? value.supportingFacts
        .filter((fact): fact is string => typeof fact === "string" && fact.trim().length > 0)
        .map((fact) => fact.trim())
        .slice(0, MAX_SUPPORTING_FACTS)
    : [];

  const matchedTransactions = Array.isArray(value.matchedTransactions)
    ? Array.from(
        new Set(
          value.matchedTransactions.filter(
            (id): id is string => typeof id === "string" && knownIds.has(id)
          )
        )
      ).slice(0, MAX_MATCHED_TRANSACTIONS)
    : [];

  return { answer, supportingFacts, matchedTransactions };
}

function errorResponse(message: string) {
  return NextResponse.json(
    {
      error: message,
      answer: message,
      supportingFacts: [],
      matchedTransactions: []
    },
    { status: 500 }
  );
}
