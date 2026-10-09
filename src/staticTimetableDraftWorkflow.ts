export type DraftCreationTarget = {
  id: string;
  titleRaw?: string | null;
  targetKey?: string | null;
  createdDraft?: unknown;
};

export type CreateAllDraftsResult<TReview> = {
  created: number;
  refreshedReview: TReview | null;
  message: string;
  error: Error | null;
};

function safeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not create draft.";
}

function targetLabel(target: DraftCreationTarget) {
  return target.titleRaw?.trim() || target.targetKey?.trim() || "Target";
}

export async function createReadyDraftsSequentially<
  TTarget extends DraftCreationTarget,
  TReview,
>(input: {
  targets: TTarget[];
  isReady: (target: TTarget) => boolean;
  createDraft: (target: TTarget) => Promise<unknown>;
  refreshReview: () => Promise<TReview>;
}) {
  let created = 0;
  let refreshedReview: TReview | null = null;

  for (const target of input.targets) {
    if (!input.isReady(target) || target.createdDraft) continue;
    try {
      await input.createDraft(target);
      created += 1;
      refreshedReview = await input.refreshReview();
    } catch (error) {
      refreshedReview = await input.refreshReview();
      return {
        created,
        refreshedReview,
        error:
          error instanceof Error ? error : new Error(safeErrorMessage(error)),
        message: `${created} draft${created === 1 ? "" : "s"} created. ${targetLabel(target)} could not be created: ${safeErrorMessage(error)}`,
      } satisfies CreateAllDraftsResult<TReview>;
    }
  }

  if (!refreshedReview) {
    refreshedReview = await input.refreshReview();
  }

  return {
    created,
    refreshedReview,
    error: null,
    message: created
      ? `${created} review draft${created === 1 ? "" : "s"} created. Nothing has been published.`
      : "No additional drafts were ready to create.",
  } satisfies CreateAllDraftsResult<TReview>;
}
