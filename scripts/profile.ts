const OWNER = "nahashed";
const ROOT = new URL("../", import.meta.url);
const TECHNOLOGIES = ["Deno", "Node.js", "grammY", "SQLite", "PostgreSQL"];
const TOPICS: Record<string, string> = {
  bitrix: "Bitrix",
  "1c-bitrix": "Bitrix",
  statamic: "Statamic",
  jenkins: "Jenkins",
  haproxy: "HAProxy",
  xray: "Xray",
  "xray-core": "Xray",
  typescript: "TypeScript",
  javascript: "JavaScript",
  rust: "Rust",
  deno: "Deno",
  nodejs: "Node.js",
  "node-js": "Node.js",
  grammy: "grammY",
  sqlite: "SQLite",
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  redis: "Redis",
  docker: "Docker",
  kubernetes: "Kubernetes",
  nginx: "NGINX",
  linux: "Linux",
  ansible: "Ansible",
  terraform: "Terraform",
  php: "PHP",
  laravel: "Laravel",
  symfony: "Symfony",
  wordpress: "WordPress",
  vue: "Vue",
  vuejs: "Vue",
  react: "React",
  nextjs: "Next.js",
  nuxt: "Nuxt",
  svelte: "Svelte",
  astro: "Astro",
  vite: "Vite",
  tailwindcss: "Tailwind CSS",
  html: "HTML",
  css: "CSS",
  sass: "Sass",
  bash: "Bash",
  go: "Go",
  golang: "Go",
  axum: "Axum",
  tokio: "Tokio",
  tauri: "Tauri",
  proxmox: "Proxmox",
  "github-actions": "GitHub Actions",
  prometheus: "Prometheus",
  grafana: "Grafana",
};
const MAX_RESPONSE = 4 * 1024 * 1024;

export class ProfileError extends Error {}

export interface API {
  get(path: string): Promise<unknown>;
}

export interface Snapshot {
  languages: [string, number][];
  technologies: string[];
  topics: string[];
}

export function detectTopics(topics: unknown): string[] {
  require(
    Array.isArray(topics) && topics.every((topic) => typeof topic === "string"),
  );
  return [
    ...new Set(
      topics.flatMap((topic: string) =>
        Object.hasOwn(TOPICS, topic.toLowerCase())
          ? [TOPICS[topic.toLowerCase()]]
          : []
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, "en"));
}

function require(condition: unknown): asserts condition {
  if (!condition) {
    throw new ProfileError(
      "Incomplete or unexpected GitHub data. Previous overview retained.",
    );
  }
}

function object(value: unknown): Record<string, unknown> {
  require(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

export class GitHub implements API {
  constructor(private token: string) {
    if (!token) {
      throw new ProfileError(
        "Set the PROFILE_READ_TOKEN repository secret first.",
      );
    }
  }

  async get(path: string): Promise<unknown> {
    try {
      const response = await fetch(`https://api.github.com${path}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "nahashed-profile",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403, 404].includes(response.status)) {
          throw new ProfileError(
            "GitHub access failed. Check token expiry, All repositories, Metadata: read and Contents: read.",
          );
        }
        throw new ProfileError(
          "GitHub API request failed. Retry the workflow later.",
        );
      }
      const reader = response.body?.getReader();
      require(reader);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_RESPONSE) {
          await reader.cancel();
          throw new ProfileError("GitHub response exceeded the safety limit.");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );
    } catch (error) {
      if (error instanceof ProfileError) throw error;
      throw new ProfileError(
        "GitHub response unavailable or invalid. Retry later.",
      );
    }
  }
}

async function repositories(api: API): Promise<Record<string, unknown>[]> {
  const account = object(await api.get("/user"));
  require(
    typeof account.login === "string" && account.login.toLowerCase() === OWNER,
  );
  const result: Record<string, unknown>[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= 1000; page++) {
    const query = new URLSearchParams({
      affiliation: "owner",
      per_page: "100",
      page: String(page),
      sort: "full_name",
    });
    const batch = await api.get(`/user/repos?${query}`);
    require(Array.isArray(batch) && batch.length <= 100);
    for (const item of batch) {
      const repo = object(item);
      const owner = object(repo.owner);
      require(
        typeof owner.login === "string" && owner.login.toLowerCase() === OWNER,
      );
      require(
        typeof repo.id === "number" && Number.isSafeInteger(repo.id) &&
          !seen.has(repo.id),
      );
      require(typeof repo.name === "string" && repo.name.length > 0);
      require(
        ["fork", "archived", "private"].every((key) =>
          typeof repo[key] === "boolean"
        ),
      );
      require(
        typeof repo.size === "number" && Number.isSafeInteger(repo.size) &&
          repo.size >= 0,
      );
      seen.add(repo.id);
      result.push(repo);
    }
    if (batch.length < 100) break;
    if (page === 1000) {
      throw new ProfileError(
        "Repository pagination exceeded the safety limit.",
      );
    }
  }
  for (
    const [key, privateRepo] of [["public_repos", false], [
      "owned_private_repos",
      true,
    ]] as const
  ) {
    if (!Number.isSafeInteger(account[key])) {
      throw new ProfileError(
        "GitHub did not expose account repository counts. Full coverage cannot be verified.",
      );
    }
    require(
      result.filter((repo) => repo.private === privateRepo).length ===
        account[key],
    );
  }
  return result;
}

export function detectTechnologies(
  manifests: Record<string, unknown>,
): Set<string> {
  const result = new Set<string>();
  for (const [filename, value] of Object.entries(manifests)) {
    const manifest = object(value);
    const dependencies: Record<string, string> = {};
    const fields = filename === "deno.json" ? ["imports"] : [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ];
    for (const field of fields) {
      const values = object(manifest[field] ?? {});
      for (const [name, dependency] of Object.entries(values)) {
        require(typeof dependency === "string");
        dependencies[name] = dependency;
      }
    }
    const scripts = object(
      manifest[filename === "deno.json" ? "tasks" : "scripts"] ?? {},
    );
    const commands = Object.values(scripts).map((value) =>
      typeof value === "string" ? value : object(value).command
    ).filter((value): value is string => typeof value === "string");
    if (
      filename === "deno.json" &&
      (Object.keys(dependencies).length ||
        commands.some((command) =>
          /\bdeno\s+(run|task|test|serve|compile)\b/.test(command)
        ))
    ) result.add("Deno");
    if (filename === "package.json") {
      const engines = object(manifest.engines ?? {});
      if (
        "node" in engines ||
        commands.some((command) => /\bnode(?:\s|$)/.test(command))
      ) result.add("Node.js");
    }
    for (const [name, dependency] of Object.entries(dependencies)) {
      if (
        name === "grammy" ||
        /^(?:https:\/\/deno\.land\/x\/grammy(?:@|\/)|(?:npm:|jsr:)grammy(?:@|$))/
          .test(dependency)
      ) result.add("grammY");
      if (
        ["sqlite3", "better-sqlite3", "@db/sqlite"].includes(name) ||
        /^(?:https:\/\/deno\.land\/x\/sqlite(?:@|\/)|jsr:@db\/sqlite(?:@|$)|node:sqlite$)/
          .test(dependency)
      ) result.add("SQLite");
      if (
        ["pg", "postgres", "@db/postgres"].includes(name) ||
        /^(?:jsr:@db\/postgres(?:@|$)|https:\/\/deno\.land\/x\/postgres(?:@|\/))/
          .test(dependency)
      ) result.add("PostgreSQL");
    }
  }
  return result;
}

export async function collect(api: API): Promise<Snapshot> {
  const languages = new Map<string, number>();
  const technologies = new Set<string>();
  const topics = new Set<string>();
  for (const repo of await repositories(api)) {
    const name = repo.name as string;
    if (
      repo.fork || repo.archived || repo.size === 0 ||
      ["test", OWNER].includes(name.toLowerCase())
    ) continue;
    const path = `/repos/${OWNER}/${encodeURIComponent(name)}`;
    const counts = object(await api.get(`${path}/languages`));
    for (const [language, count] of Object.entries(counts)) {
      require(
        language.length > 0 && language.length <= 80 &&
          ![...language].some((char) => char.charCodeAt(0) < 32),
      );
      require(
        typeof count === "number" && Number.isSafeInteger(count) && count > 0,
      );
    }
    if (!Object.keys(counts).length) continue;
    for (const topic of detectTopics(repo.topics ?? [])) topics.add(topic);
    require(
      typeof repo.default_branch === "string" && repo.default_branch.length > 0,
    );
    const reference = `?${new URLSearchParams({ ref: repo.default_branch })}`;
    const entries = await api.get(`${path}/contents${reference}`);
    require(Array.isArray(entries));
    const manifests: Record<string, unknown> = {};
    for (const item of entries) {
      const entry = object(item);
      require(typeof entry.name === "string");
      if (!["deno.json", "package.json"].includes(entry.name)) continue;
      require(
        entry.type === "file" && typeof entry.size === "number" &&
          entry.size < MAX_RESPONSE,
      );
      const document = object(
        await api.get(`${path}/contents/${entry.name}${reference}`),
      );
      require(
        document.encoding === "base64" && document.type === "file" &&
          !document.target && typeof document.content === "string",
      );
      try {
        const bytes = Uint8Array.from(
          atob(document.content.replace(/\s/g, "")),
          (char) => char.charCodeAt(0),
        );
        manifests[entry.name] = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        );
      } catch {
        throw new ProfileError(
          "A root manifest is not valid JSON. Previous overview retained.",
        );
      }
    }
    for (const [language, count] of Object.entries(counts)) {
      languages.set(
        language,
        (languages.get(language) ?? 0) + (count as number),
      );
    }
    for (const tech of detectTechnologies(manifests)) technologies.add(tech);
  }
  return {
    languages: [...languages].sort(([a, x], [b, y]) =>
      y - x || a.localeCompare(b, "en")
    ),
    technologies: TECHNOLOGIES.filter((tech) => technologies.has(tech)),
    topics: [...topics].sort((a, b) => a.localeCompare(b, "en")),
  };
}

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function render(snapshot: Snapshot | null, dark: boolean): string {
  const [background, foreground, muted, border] = dark
    ? ["#0d1117", "#f0f3f6", "#9da7b3", "#30363d"]
    : ["#ffffff", "#1f2328", "#59636e", "#d1d9e0"];
  const colors = [
    "#ed2207",
    "#db775d",
    "#bb958b",
    "#989fa9",
    "#69798b",
    "#44556d",
  ];
  const rows = snapshot?.languages.slice(0, 5) ?? [];
  if (snapshot && snapshot.languages.length > 5) {
    rows.push([
      "Other",
      snapshot.languages.slice(5).reduce((sum, [, count]) => sum + count, 0),
    ]);
  }
  const topicLines: string[] = [];
  for (const topic of snapshot?.topics ?? []) {
    const last = topicLines.at(-1);
    if (last && last.length + topic.length + 3 <= 72) {
      topicLines[topicLines.length - 1] += ` / ${topic}`;
    } else topicLines.push(topic);
  }
  const baseHeight = 192 + Math.max(1, rows.length) * 30;
  const height = baseHeight +
    (topicLines.length ? 42 + topicLines.length * 25 : 0);
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="${height}" viewBox="0 0 760 ${height}" role="img" aria-labelledby="title description">`,
    '<title id="title">Languages &amp; technologies</title>',
    '<desc id="description">Aggregated code volume and detected technologies. Private project details are not published.</desc>',
    `<rect x="0.5" y="0.5" width="759" height="${
      height - 1
    }" rx="14" fill="${background}" stroke="${border}"/>`,
    '<rect x="28" y="28" width="4" height="24" rx="2" fill="#ed2207"/>',
    `<g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" fill="${foreground}">`,
    '<text x="44" y="47" font-size="22" font-weight="600">Languages &amp; technologies</text>',
    `<text x="28" y="75" font-size="13" fill="${muted}">CODE VOLUME / OWNED PROJECTS</text>`,
  ];
  const total =
    snapshot?.languages.reduce((sum, [, count]) => sum + count, 0) ?? 0;
  let x = 28;
  rows.forEach(([language, count], index) => {
    const width = 704 * count / total;
    const y = 133 + index * 30;
    parts.push(
      `<rect x="${x.toFixed(3)}" y="96" width="${
        width.toFixed(3)
      }" height="8" fill="${colors[index]}"/>`,
      `<circle cx="33" cy="${y - 5}" r="4" fill="${colors[index]}"/>`,
      `<text x="48" y="${y}" font-size="15">${escape(language)}</text>`,
      `<text x="732" y="${y}" text-anchor="end" font-size="15" fill="${muted}">${
        (count / total * 100).toFixed(1)
      }%</text>`,
    );
    x += width;
  });
  if (!rows.length) {
    parts.push(
      `<text x="28" y="133" font-size="15" fill="${muted}">${
        snapshot ? "No eligible code to summarize." : "First snapshot pending."
      }</text>`,
    );
  }
  const techY = baseHeight - 50;
  const techText = snapshot?.technologies.length
    ? snapshot.technologies.join(" / ")
    : snapshot
    ? "None detected in root manifests"
    : "Awaiting project configuration";
  parts.push(
    `<path d="M28 ${techY - 26}H732" stroke="${border}"/>`,
    `<text x="28" y="${techY}" font-size="12" fill="${muted}">DETECTED TECHNOLOGIES</text>`,
    `<text x="28" y="${techY + 26}" font-size="16" font-weight="500">${
      escape(techText)
    }</text>`,
  );
  if (topicLines.length) {
    parts.push(
      `<text x="28" y="${
        baseHeight + 14
      }" font-size="12" fill="${muted}">FROM PROJECT TOPICS</text>`,
    );
    topicLines.forEach((line, index) =>
      parts.push(
        `<text x="28" y="${baseHeight + 40 + index * 25}" font-size="15">${
          escape(line)
        }</text>`,
      )
    );
  }
  parts.push("</g></svg>\n");
  return parts.join("\n");
}

export async function update(api: API, root: URL = ROOT): Promise<boolean> {
  const snapshot = await collect(api);
  const outputs = ["light", "dark"].map((theme) => ({
    path: new URL(`assets/stack-${theme}.svg`, root),
    content: render(snapshot, theme === "dark"),
  }));
  let changed = false;
  for (const { path, content } of outputs) {
    let previous = "";
    try {
      previous = await Deno.readTextFile(path);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (previous !== content) {
      await Deno.mkdir(new URL("assets/", root), { recursive: true });
      await Deno.writeTextFile(path, content);
      changed = true;
    }
  }
  return changed;
}

export async function run(
  createAPI: () => API,
  root: URL = ROOT,
): Promise<number> {
  try {
    const changed = await update(createAPI(), root);
    console.log(
      changed ? "Profile overview updated." : "Profile overview unchanged.",
    );
    return 0;
  } catch (error) {
    console.error(
      error instanceof ProfileError
        ? `Profile update failed: ${error.message}`
        : "Profile update failed unexpectedly. No API details logged. Check generator and permissions.",
    );
    return 1;
  }
}

if (import.meta.main) {
  Deno.exit(
    await run(() => new GitHub(Deno.env.get("PROFILE_READ_TOKEN") ?? "")),
  );
}
