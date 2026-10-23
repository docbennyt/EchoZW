interface CandidateInput {
  sha: string;
  pull: {
    state: string;
    base: { ref: string };
    head: { sha: string; repo?: { full_name: string } };
    user: { login: string };
  };
  reviews: { user: { login: string }; state: string; commit_id: string }[];
  runs: {
    id: number;
    head_sha: string;
    path: string;
    event: string;
    conclusion: string | null;
  }[];
  permissions: Record<string, string>;
}
export function authorizeCandidate(input: CandidateInput): string;
