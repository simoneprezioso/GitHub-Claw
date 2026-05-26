import { Suspense } from "react";
import { HomeClient } from "./HomeClient";

// Server component. The Suspense boundary is required because HomeClient
// reads `useSearchParams()`, which forces dynamic rendering of its subtree.
export default function HomePage() {
  return (
    <Suspense fallback={<HomeFallback />}>
      <HomeClient />
    </Suspense>
  );
}

function HomeFallback() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-4 px-4">
      <div className="flex items-center gap-2 text-ink-400">
        <span aria-hidden className="text-2xl">🐙</span>
        <span className="text-sm">Loading…</span>
      </div>
    </main>
  );
}
