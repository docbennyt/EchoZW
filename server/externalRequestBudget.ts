import { AsyncLocalStorage } from "node:async_hooks";

type Budget = {
  limit: number;
  used: number;
  progressed: boolean;
  exhausted: boolean;
};
const budgets = new AsyncLocalStorage<Budget>();

class ExternalRequestBudgetExceeded extends Error {
  readonly code: string;
  constructor(progressed: boolean) {
    super("Google reconciliation requires another bounded invocation.");
    this.code = progressed
      ? "GOOGLE_SYNC_CONTINUE"
      : "GOOGLE_SYNC_BUDGET_EXHAUSTED";
  }
}

export async function withExternalRequestBudget<T>(
  limit: number,
  work: () => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 40)
    throw new Error("Invalid external request budget.");
  const budget: Budget = {
    limit,
    used: 0,
    progressed: false,
    exhausted: false,
  };
  return budgets.run(budget, async () => {
    try {
      return await work();
    } catch (error) {
      // Supabase and provider adapters may wrap fetch errors. Keep continuation explicit.
      if (budget.exhausted)
        throw new ExternalRequestBudgetExceeded(budget.progressed);
      throw error;
    }
  });
}

export function markExternalWorkProgress() {
  const budget = budgets.getStore();
  if (budget) budget.progressed = true;
}

export async function budgetedFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  const budget = budgets.getStore();
  if (budget) {
    if (budget.used >= budget.limit) {
      budget.exhausted = true;
      throw new ExternalRequestBudgetExceeded(budget.progressed);
    }
    budget.used += 1;
  }
  const rejectRedirect = Boolean(budget) || init?.redirect === "error";
  // workerd does not implement redirect:"error". Never follow privileged redirects.
  const response = await fetch(
    input,
    rejectRedirect ? { ...init, redirect: "manual" } : init,
  );
  if (rejectRedirect && response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("External service redirects are not allowed.");
  }
  return response;
}
