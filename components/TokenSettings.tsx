"use client";

import { useState } from "react";

interface Props {
  token: string | null;
  onChange: (token: string | null) => void;
}

// Lets a user paste their OWN GitHub token to lift the rate limit from 60 to
// 5,000 requests/hour without the operator sharing a single server-side PAT
// across everyone. The token is stored only in this browser's localStorage and
// sent per-request via the `x-github-token` header (never in the URL or body).
// This is the pragmatic groundwork toward full per-user OAuth / a GitHub App.
export function TokenSettings({ token, onChange }: Props) {
  const [draft, setDraft] = useState(token ?? "");

  return (
    <details className="mt-3 text-xs text-ink-500">
      <summary className="cursor-pointer select-none hover:text-ink-900">
        🔑 {token ? "Using your GitHub token" : "Add your GitHub token for higher rate limits"}
      </summary>
      <div className="mt-2 space-y-2 rounded-md border border-ink-200 bg-white p-3">
        <p className="text-ink-600">
          Optional. A token raises your GitHub limit from 60 to 5,000 requests/hour. It’s
          stored only in this browser and sent over HTTPS with each search — never saved
          on the server. A classic token with <em>no scopes</em> is enough for public search.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="ghp_…"
            aria-label="Your GitHub personal access token"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-ink-200 bg-white px-2.5 py-1.5 font-mono text-ink-900 focus:border-ink-900"
          />
          <button
            type="button"
            onClick={() => onChange(draft.trim() || null)}
            className="rounded-md bg-ink-900 px-3 py-1.5 font-medium text-white transition hover:bg-ink-700"
          >
            Save
          </button>
          {token && (
            <button
              type="button"
              onClick={() => {
                setDraft("");
                onChange(null);
              }}
              className="rounded-md border border-ink-200 px-3 py-1.5 text-ink-700 transition hover:border-ink-900 hover:text-ink-900"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
