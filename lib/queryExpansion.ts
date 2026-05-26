// Turn a plain-English idea into a small set of GitHub search queries plus a
// bag of expansion terms used by the ranker.
//
// The core idea: the user types something fuzzy ("self-hosted Typeform
// alternative built with React"), and we deterministically pull out
//   - core keywords ("typeform", "react")
//   - implied category terms ("form builder", "survey")
//   - implementation/tech terms ("react")
//   - stylistic modifiers ("self-hosted", "open source")
// We never hit an LLM here. The map below is small but covers the kinds of
// ideas this tool is designed for. Unknown nouns fall through unchanged —
// GitHub's search is forgiving with synonyms in name/description/readme.

import { meaningfulTokens, uniq } from "./utils";

// Convert a hand-written trigger phrase into a word-boundary regex that
// also tolerates a trailing "s" on each word (so "record terminal" still
// matches "records terminal"). Multi-word phrases must appear in order,
// but with arbitrary whitespace between words.
function triggerToRegex(trigger: string): RegExp {
  const words = trigger.toLowerCase().split(/\s+/).filter(Boolean);
  const pattern = words
    .map((w) => `${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?`)
    .join("\\s+");
  return new RegExp(`\\b${pattern}\\b`, "i");
}

function matchesAnyTrigger(text: string, triggers: string[]): boolean {
  return triggers.some((t) => triggerToRegex(t).test(text));
}

// Curated category synonyms, keyed by triggers found in the user's query.
// Each entry expands to alternative terms and likely GitHub topics.
const CATEGORY_MAP: Array<{
  triggers: string[];
  terms: string[];
  topics: string[];
}> = [
  {
    triggers: ["typeform", "form builder", "survey", "google forms"],
    terms: ["form builder", "survey", "forms", "questionnaire", "formbricks", "form.io"],
    topics: ["forms", "form-builder", "survey", "surveys"],
  },
  {
    triggers: ["notion", "wiki", "knowledge base", "note taking", "notes app"],
    terms: ["notion alternative", "wiki", "knowledge base", "notes", "outliner", "block editor"],
    topics: ["notion", "wiki", "notes", "knowledge-base", "second-brain"],
  },
  {
    triggers: ["airtable", "spreadsheet database", "no code database"],
    terms: ["airtable alternative", "database", "spreadsheet", "nocodb", "baserow"],
    topics: ["airtable", "database", "nocode", "no-code"],
  },
  {
    triggers: ["slack", "discord", "chat app", "team chat"],
    terms: ["slack alternative", "chat", "messaging", "team communication", "mattermost", "rocket chat"],
    topics: ["chat", "messaging", "slack", "team-chat"],
  },
  {
    triggers: ["zapier", "workflow automation", "if this then that", "ifttt"],
    terms: ["workflow automation", "integrations", "n8n", "zapier alternative", "trigger"],
    topics: ["automation", "workflow", "no-code", "integrations"],
  },
  {
    triggers: ["analytics", "google analytics", "tracking", "telemetry"],
    terms: ["analytics", "tracking", "telemetry", "plausible", "umami", "posthog"],
    topics: ["analytics", "tracking", "metrics"],
  },
  {
    triggers: ["calendar", "calendly", "scheduling", "booking"],
    terms: ["calendar", "scheduling", "booking", "cal.com", "calendly alternative"],
    topics: ["calendar", "scheduling", "booking"],
  },
  {
    triggers: ["pdf", "extract pdf", "parse pdf", "pdf parser"],
    terms: ["pdf parser", "pdf extraction", "pdf to json", "ocr", "document parsing"],
    topics: ["pdf", "pdf-parser", "ocr", "document-processing"],
  },
  {
    triggers: [
      "terminal recorder",
      "asciinema",
      "record terminal",
      "tty recorder",
      "terminal session",
      "terminal gif",
      "screencast",
      "asciicast",
    ],
    terms: [
      "terminal recording",
      "asciinema",
      "tty recorder",
      "terminal gif",
      "shell recording",
      "screencast",
    ],
    topics: ["terminal", "asciinema", "cli", "screencast"],
  },
  {
    triggers: ["browser agent", "browser automation", "headless browser"],
    terms: ["browser automation", "playwright", "puppeteer", "browser agent", "web automation"],
    topics: ["browser-automation", "playwright", "puppeteer", "ai-agent"],
  },
  {
    triggers: ["agent framework", "ai agent", "llm agent", "autonomous agent"],
    terms: ["agent framework", "llm agent", "ai agent", "autonomous agent", "tool use"],
    topics: ["llm", "ai-agent", "agents", "autonomous-agents"],
  },
  {
    triggers: ["rag", "retrieval augmented", "vector search"],
    terms: ["rag", "retrieval augmented generation", "vector search", "embeddings", "semantic search"],
    topics: ["rag", "vector-database", "embeddings", "llm"],
  },
  {
    triggers: ["chat with pdf", "chat with docs", "doc qa", "document qa"],
    terms: ["chat with documents", "document qa", "rag", "pdf chat"],
    topics: ["rag", "llm", "pdf"],
  },
  {
    triggers: ["dashboard", "admin panel", "internal tool"],
    terms: ["admin dashboard", "admin panel", "internal tool", "retool alternative", "appsmith"],
    topics: ["dashboard", "admin", "internal-tools", "low-code"],
  },
  {
    triggers: ["crm", "customer relationship"],
    terms: ["crm", "customer relationship management", "sales pipeline"],
    topics: ["crm", "sales"],
  },
  {
    triggers: ["email", "newsletter", "mailing list", "mailchimp"],
    terms: ["email marketing", "newsletter", "mailing list", "listmonk", "mailchimp alternative"],
    topics: ["email", "newsletter", "smtp"],
  },
  {
    triggers: ["bug tracker", "issue tracker", "linear", "jira"],
    terms: ["issue tracker", "bug tracker", "project management", "linear alternative"],
    topics: ["issue-tracker", "project-management"],
  },
  {
    triggers: ["password manager", "1password", "bitwarden"],
    terms: ["password manager", "secrets manager", "vault", "bitwarden alternative"],
    topics: ["password-manager", "security", "secrets"],
  },
  {
    triggers: ["file storage", "dropbox", "google drive"],
    terms: ["file storage", "cloud storage", "dropbox alternative", "nextcloud", "self-hosted storage"],
    topics: ["cloud-storage", "file-sharing", "self-hosted"],
  },
  {
    triggers: ["status page", "uptime", "monitoring"],
    terms: ["status page", "uptime monitoring", "incident management", "statuspage"],
    topics: ["monitoring", "status-page", "uptime"],
  },
  {
    triggers: ["screenshot", "screen capture"],
    terms: ["screenshot tool", "screen capture", "screencast"],
    topics: ["screenshot", "screencast"],
  },
  {
    triggers: ["video editor", "video editing"],
    terms: ["video editor", "video editing", "ffmpeg gui"],
    topics: ["video-editor", "video-editing"],
  },
  {
    triggers: ["image editor", "photo editor", "photoshop"],
    terms: ["image editor", "photo editor", "photoshop alternative", "gimp"],
    topics: ["image-editor", "graphics"],
  },
  {
    triggers: ["markdown editor", "note editor"],
    terms: ["markdown editor", "markdown notes", "wysiwyg markdown"],
    topics: ["markdown", "editor", "notes"],
  },
  {
    triggers: ["ci cd", "ci/cd", "continuous integration", "github actions"],
    terms: ["ci cd", "continuous integration", "build pipeline", "deployment"],
    topics: ["ci-cd", "devops", "github-actions"],
  },
  {
    triggers: ["kubernetes", "k8s", "container orchestration"],
    terms: ["kubernetes", "k8s", "container orchestration", "helm"],
    topics: ["kubernetes", "k8s", "containers"],
  },
  // ─── Phase C expansion: ~30 additional categories ────────────────────────
  {
    triggers: ["kanban", "trello", "task board", "kanban board"],
    terms: ["kanban", "trello alternative", "task board", "project board", "wekan", "focalboard"],
    topics: ["kanban", "trello", "project-management", "task-management"],
  },
  {
    triggers: ["obsidian", "logseq", "joplin", "personal wiki", "second brain"],
    terms: ["obsidian alternative", "logseq", "joplin", "personal knowledge", "second brain", "zettelkasten"],
    topics: ["notes", "knowledge-base", "second-brain", "zettelkasten", "obsidian"],
  },
  {
    triggers: ["excalidraw", "drawing tool", "whiteboard", "diagram", "diagramming"],
    terms: ["excalidraw", "drawing tool", "whiteboard", "diagrams", "tldraw", "miro alternative"],
    topics: ["drawing", "whiteboard", "diagram", "excalidraw"],
  },
  {
    triggers: ["time tracking", "time tracker", "toggl", "harvest"],
    terms: ["time tracking", "timesheet", "toggl alternative", "kimai"],
    topics: ["time-tracking", "timesheet"],
  },
  {
    triggers: ["habit tracker", "streak tracker", "habit"],
    terms: ["habit tracker", "habit", "streak", "daily routine"],
    topics: ["habits", "habit-tracker", "productivity"],
  },
  {
    triggers: ["url shortener", "link shortener", "bitly"],
    terms: ["url shortener", "link shortener", "bitly alternative", "shlink", "yourls"],
    topics: ["url-shortener", "links"],
  },
  {
    triggers: ["pastebin", "code paste", "snippet share", "gist clone"],
    terms: ["pastebin", "code paste", "snippet sharing", "gist clone"],
    topics: ["pastebin", "snippets"],
  },
  {
    triggers: ["static site generator", "ssg", "hugo", "jekyll", "11ty", "eleventy", "astro"],
    terms: ["static site generator", "ssg", "static blog", "hugo", "jekyll", "eleventy", "astro"],
    topics: ["static-site-generator", "ssg", "static-site"],
  },
  {
    triggers: ["headless cms", "strapi", "directus", "sanity", "payload cms"],
    terms: ["headless cms", "strapi", "directus", "payload", "ghost"],
    topics: ["cms", "headless-cms", "strapi", "directus"],
  },
  {
    triggers: ["database client", "db client", "dbeaver", "tableplus", "database gui"],
    terms: ["database client", "database gui", "sql client", "dbeaver alternative"],
    topics: ["database", "sql", "database-gui"],
  },
  {
    triggers: ["ssh client", "ssh manager", "terminal client", "termius"],
    terms: ["ssh client", "ssh manager", "terminal", "tabby"],
    topics: ["ssh", "terminal"],
  },
  {
    triggers: ["git gui", "git client", "sourcetree", "gitkraken", "gitui"],
    terms: ["git gui", "git client", "sourcetree alternative", "lazygit", "gitui"],
    topics: ["git", "git-gui", "git-client"],
  },
  {
    triggers: ["code review", "gerrit", "reviewboard", "review tool"],
    terms: ["code review", "pull request review", "gerrit", "reviewboard"],
    topics: ["code-review", "git", "pull-requests"],
  },
  {
    triggers: ["feature flag", "feature toggle", "launchdarkly", "feature flags"],
    terms: ["feature flag", "feature toggle", "launchdarkly alternative", "unleash", "flagsmith"],
    topics: ["feature-flags", "feature-toggles", "experimentation"],
  },
  {
    triggers: ["ab test", "a/b test", "split test", "experimentation"],
    terms: ["ab testing", "a b testing", "split testing", "experimentation platform"],
    topics: ["ab-testing", "experimentation", "feature-flags"],
  },
  {
    triggers: ["meilisearch", "typesense", "elasticsearch alternative", "full text search", "search engine"],
    terms: ["full text search", "search engine", "meilisearch", "typesense", "elasticsearch"],
    topics: ["search", "search-engine", "full-text-search", "meilisearch", "typesense"],
  },
  {
    triggers: ["rss reader", "feed reader", "rss aggregator", "miniflux", "freshrss"],
    terms: ["rss reader", "feed reader", "miniflux", "freshrss", "rss aggregator"],
    topics: ["rss", "feed-reader", "atom"],
  },
  {
    triggers: ["bookmark manager", "bookmarks", "pinboard", "raindrop", "linkding"],
    terms: ["bookmark manager", "bookmarks", "pinboard alternative", "linkding", "raindrop"],
    topics: ["bookmarks", "bookmark-manager"],
  },
  {
    triggers: ["photo gallery", "photo manager", "lightroom alternative", "immich", "photoprism"],
    terms: ["photo gallery", "photo manager", "immich", "photoprism", "self-hosted photos"],
    topics: ["photos", "photo-gallery", "photoprism", "immich"],
  },
  {
    triggers: ["music player", "music streaming", "spotify alternative", "navidrome", "jellyfin music"],
    terms: ["music player", "music streaming", "navidrome", "subsonic", "spotify alternative"],
    topics: ["music", "music-player", "navidrome", "subsonic"],
  },
  {
    triggers: ["translation", "deepl", "i18n", "localization", "internationalization"],
    terms: ["translation", "i18n", "internationalization", "localization", "translate"],
    topics: ["i18n", "localization", "translation"],
  },
  {
    triggers: ["game engine", "godot", "unity alternative", "bevy"],
    terms: ["game engine", "godot", "bevy", "unity alternative", "game development"],
    topics: ["game-engine", "game-development", "godot", "bevy"],
  },
  {
    triggers: ["vector database", "vector db", "pinecone", "qdrant", "weaviate", "chroma db"],
    terms: ["vector database", "vector db", "qdrant", "weaviate", "chroma", "milvus", "embeddings"],
    topics: ["vector-database", "vector-search", "embeddings", "qdrant", "weaviate"],
  },
  {
    triggers: ["live streaming", "obs", "rtmp", "twitch alternative"],
    terms: ["live streaming", "obs alternative", "rtmp server", "streaming"],
    topics: ["streaming", "live-streaming", "obs", "rtmp"],
  },
  {
    triggers: ["code editor", "ide", "vscode alternative", "vim", "neovim"],
    terms: ["code editor", "ide", "vscode alternative", "neovim", "lapce", "zed"],
    topics: ["ide", "code-editor", "editor"],
  },
  {
    triggers: ["whiteboard collab", "miro alternative", "figjam alternative"],
    terms: ["whiteboard", "collaborative whiteboard", "miro alternative", "tldraw", "excalidraw"],
    topics: ["whiteboard", "collaboration"],
  },
  {
    triggers: ["project management", "asana", "monday", "linear alternative", "task management"],
    terms: ["project management", "task management", "asana alternative", "linear alternative", "openproject"],
    topics: ["project-management", "task-management", "productivity"],
  },
  {
    triggers: ["helpdesk", "zendesk", "support ticket", "ticketing system"],
    terms: ["helpdesk", "support ticket", "zendesk alternative", "freescout", "zammad"],
    topics: ["helpdesk", "support", "ticketing"],
  },
  {
    triggers: ["backup", "borg", "restic", "duplicati", "backup tool"],
    terms: ["backup", "backup tool", "borgbackup", "restic", "duplicati"],
    topics: ["backup", "backup-tool", "restic", "borgbackup"],
  },
  {
    triggers: ["mesh vpn", "tailscale", "wireguard", "headscale", "netbird"],
    terms: ["mesh vpn", "vpn", "wireguard", "tailscale alternative", "headscale", "netbird"],
    topics: ["vpn", "wireguard", "mesh-vpn", "tailscale"],
  },
  {
    triggers: ["document signing", "esign", "esignature", "docusign alternative", "pdf sign"],
    terms: ["document signing", "esignature", "docusign alternative", "documenso", "pdf signing"],
    topics: ["esignature", "pdf", "document-signing"],
  },
];

// Lightweight tech stack detection. Matches common languages/frameworks the
// user may have specified as a constraint ("built with React").
const TECH_TERMS: Array<{ trigger: RegExp; terms: string[]; topic?: string }> = [
  { trigger: /\breact\b/i, terms: ["react"], topic: "react" },
  { trigger: /\bnext\.?js\b/i, terms: ["nextjs", "next.js"], topic: "nextjs" },
  { trigger: /\bvue\b/i, terms: ["vue"], topic: "vue" },
  { trigger: /\bsvelte\b/i, terms: ["svelte"], topic: "svelte" },
  { trigger: /\bsolid(js)?\b/i, terms: ["solidjs"], topic: "solidjs" },
  { trigger: /\bangular\b/i, terms: ["angular"], topic: "angular" },
  { trigger: /\btypescript\b/i, terms: ["typescript"], topic: "typescript" },
  { trigger: /\bjavascript\b/i, terms: ["javascript"], topic: "javascript" },
  { trigger: /\bpython\b/i, terms: ["python"], topic: "python" },
  { trigger: /\brust\b/i, terms: ["rust"], topic: "rust" },
  { trigger: /\bgo(lang)?\b/i, terms: ["go", "golang"], topic: "go" },
  { trigger: /\belixir\b/i, terms: ["elixir"], topic: "elixir" },
  { trigger: /\brails?\b/i, terms: ["ruby on rails", "rails"], topic: "rails" },
  { trigger: /\bdjango\b/i, terms: ["django"], topic: "django" },
  { trigger: /\bflask\b/i, terms: ["flask"], topic: "flask" },
  { trigger: /\bfastapi\b/i, terms: ["fastapi"], topic: "fastapi" },
  { trigger: /\btauri\b/i, terms: ["tauri"], topic: "tauri" },
  { trigger: /\belectron\b/i, terms: ["electron"], topic: "electron" },
  { trigger: /\bcli\b/i, terms: ["cli"], topic: "cli" },
  { trigger: /\bplaywright\b/i, terms: ["playwright"], topic: "playwright" },
  { trigger: /\bpuppeteer\b/i, terms: ["puppeteer"], topic: "puppeteer" },
];

// Modifiers that change the *kind* of project the user wants. These add useful
// extra search terms but should not narrow GitHub's keyword search too much,
// so we keep them as a separate bag.
const MODIFIERS: Array<{ trigger: RegExp; terms: string[]; topics?: string[] }> = [
  { trigger: /\bself[- ]?hosted\b/i, terms: ["self-hosted", "self hosted"], topics: ["self-hosted"] },
  { trigger: /\blocal[- ]?first\b/i, terms: ["local-first", "local first", "offline first"], topics: ["local-first"] },
  { trigger: /\boffline\b/i, terms: ["offline", "offline first"], topics: ["offline"] },
  { trigger: /\bopen[- ]?source\b/i, terms: ["open source"], topics: ["oss"] },
  { trigger: /\bmobile\b/i, terms: ["mobile"], topics: ["mobile"] },
  { trigger: /\bandroid\b/i, terms: ["android"], topics: ["android"] },
  { trigger: /\bios\b/i, terms: ["ios"], topics: ["ios"] },
  { trigger: /\bdesktop\b/i, terms: ["desktop"], topics: ["desktop"] },
];

export interface ExpandedQuery {
  // Cleaned, lowercased version of the user input.
  rawQuery: string;
  // Bag of expansion terms used by the ranker (synonyms, alt names, topics).
  expansionTerms: string[];
  // Topics (GitHub topic slugs) that are likely relevant.
  topics: string[];
  // The set of GitHub search query strings to actually fire. Ordered:
  // narrowest first so duplicates get the highest "candidate rank".
  searchQueries: string[];
}

export function expandQuery(rawInput: string): ExpandedQuery {
  const input = rawInput.trim();
  const lower = input.toLowerCase();
  const tokens = meaningfulTokens(input);

  const expansionTerms: string[] = [...tokens];
  const topics: string[] = [];

  // Category synonyms.
  for (const cat of CATEGORY_MAP) {
    if (matchesAnyTrigger(lower, cat.triggers)) {
      expansionTerms.push(...cat.terms);
      topics.push(...cat.topics);
    }
  }

  // Tech stack hints.
  const techTerms: string[] = [];
  for (const tech of TECH_TERMS) {
    if (tech.trigger.test(input)) {
      techTerms.push(...tech.terms);
      if (tech.topic) topics.push(tech.topic);
    }
  }
  expansionTerms.push(...techTerms);

  // Modifier hints.
  const modifierTerms: string[] = [];
  for (const mod of MODIFIERS) {
    if (mod.trigger.test(input)) {
      modifierTerms.push(...mod.terms);
      if (mod.topics) topics.push(...mod.topics);
    }
  }
  expansionTerms.push(...modifierTerms);

  // "alternative to X" / "X alternative" pattern — capture X as a strong signal.
  const altMatch =
    input.match(/\balternative(?:s)? to ([a-z0-9.\- ]+)/i) ||
    input.match(/\b([a-z0-9.\-]+) alternative\b/i);
  if (altMatch) {
    const target = altMatch[1].trim().toLowerCase();
    if (target.length > 1) {
      expansionTerms.push(target, `${target} alternative`, `open source ${target}`);
    }
  }

  // "X clone" pattern.
  const cloneMatch = input.match(/\b([a-z0-9.\-]+) clone\b/i);
  if (cloneMatch) {
    const target = cloneMatch[1].trim().toLowerCase();
    expansionTerms.push(target, `${target} clone`, `open source ${target}`);
  }

  const dedupedTerms = uniq(expansionTerms.filter((t) => t.length > 1));
  const dedupedTopics = uniq(topics);

  // Build the actual GitHub search query strings.
  //
  // Strategy: a few orthogonal queries that together give us diverse
  // candidates without burning the rate limit. Each query restricts to repos
  // with at least a few stars to filter out the long tail of empty repos.
  //
  // Important: GitHub's search treats space between qualifiers as AND, so
  // stacking multiple `topic:` filters in one query is *very* restrictive.
  // We use at most one topic per query and rely on parallel queries to
  // cover the topic space.
  const coreTerms = tokens.slice(0, 5).join(" ");
  // Synonym terms the user *didn't* type — these are what bridge "records
  // terminal as gif" → "asciinema". Single-word names + names with dots/dashes
  // (form.io) make the best GitHub keyword candidates.
  const synonymPicks = dedupedTerms
    .filter((t) => !tokens.includes(t))
    .filter((t) => !t.includes(" ") || t.length > 4)
    .slice(0, 5);

  const queries: string[] = [];

  if (coreTerms) {
    queries.push(`${coreTerms} in:name,description,readme stars:>5`);
  }

  // Synonym query — broadens reach to repos that use the canonical name for a
  // category even when the user described it generically.
  if (synonymPicks.length > 0) {
    const orList = synonymPicks
      .map((t) => (t.includes(" ") ? `"${t}"` : t))
      .join(" OR ");
    queries.push(`${orList} in:name,description stars:>5`);
  }

  // Topic-restricted query: a single, narrow topic gives focused results.
  // Prefer non-language topics since languages often dominate the list.
  const TECH_TOPICS = new Set([
    "react", "vue", "svelte", "angular", "solidjs", "nextjs",
    "typescript", "javascript", "python", "rust", "go", "elixir",
    "rails", "django", "flask", "fastapi", "tauri", "electron",
    "playwright", "puppeteer",
  ]);
  const focusedTopic = dedupedTopics.find((t) => !TECH_TOPICS.has(t)) ?? dedupedTopics[0];
  if (focusedTopic) {
    const topicTextBits = tokens.slice(0, 2).join(" ");
    queries.push(`topic:${focusedTopic} ${topicTextBits} stars:>5`.trim());
  }

  // Alternative/clone signal — broadens the net to obvious competitors.
  if (altMatch || cloneMatch) {
    const target = (altMatch?.[1] || cloneMatch?.[1] || "").trim().toLowerCase();
    if (target) {
      queries.push(`${target} alternative in:name,description stars:>5`);
    }
  }

  // Fallback if everything was filtered out (e.g. only stopwords).
  if (queries.length === 0) {
    queries.push(`${input} stars:>5`);
  }

  return {
    rawQuery: input,
    expansionTerms: dedupedTerms,
    topics: dedupedTopics,
    searchQueries: uniq(queries),
  };
}
