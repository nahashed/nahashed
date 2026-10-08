import {
  type API,
  collect,
  detectTechnologies,
  detectTopics,
  ProfileError,
  render,
  run,
  type Snapshot,
  update,
} from "../scripts/profile.ts";

const CANARY = "secret-project-never-publish-7f92";

function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error("Assertion failed");
}

function equal(actual: unknown, expected: unknown) {
  assert(JSON.stringify(actual) === JSON.stringify(expected));
}

async function rejects(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    assert(error instanceof ProfileError);
    return;
  }
  throw new Error("Expected a sanitized failure");
}

function repo(name: string, id = 1, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
    owner: { login: "nahashed" },
    fork: false,
    archived: false,
    private: true,
    size: 10,
    default_branch: "main",
    ...overrides,
  };
}

class FakeAPI implements API {
  requests: string[] = [];
  constructor(
    readonly repos: ReturnType<typeof repo>[],
    private counts: Record<string, Record<string, number>> = {},
    private manifests: Record<string, Record<string, unknown>> = {},
  ) {}

  get(path: string): Promise<unknown> {
    this.requests.push(path);
    if (path === "/user") {
      return Promise.resolve({
        login: "nahashed",
        public_repos: this.repos.filter((repo) => !repo.private).length,
        owned_private_repos: this.repos.filter((repo) => repo.private).length,
      });
    }
    if (path.startsWith("/user/repos?")) {
      const page = Number(
        new URL(path, "https://api.github.com").searchParams.get("page"),
      );
      return Promise.resolve(this.repos.slice((page - 1) * 100, page * 100));
    }
    const name = path.split("/")[3];
    if (path.endsWith("/languages")) {
      return Promise.resolve(this.counts[name] ?? {});
    }
    const manifests = this.manifests[name] ?? {};
    if (path.includes("/contents?")) {
      return Promise.resolve(
        Object.keys(manifests).map((name) => ({
          name,
          type: "file",
          size: 100,
        })),
      );
    }
    const filename = path.split("/contents/")[1].split("?")[0];
    return Promise.resolve({
      type: "file",
      encoding: "base64",
      content: btoa(JSON.stringify(manifests[filename])),
    });
  }
}

function example() {
  return new FakeAPI(
    [repo(CANARY), repo("public-example", 2, { private: false })],
    {
      [CANARY]: { TypeScript: 300, Rust: 100 },
      "public-example": { Rust: 600 },
    },
    {
      [CANARY]: {
        "deno.json": {
          tasks: { start: "deno run main.ts" },
          imports: {
            grammy: "https://deno.land/x/grammy@v1/mod.ts",
            sqlite: "https://deno.land/x/sqlite@v3/mod.ts",
            [CANARY]: "https://internal.invalid/" + CANARY,
          },
        },
      },
    },
  );
}

Deno.test("aggregates byte counts, not repository percentages", async () => {
  equal(await collect(example()), {
    languages: [["Rust", 700], ["TypeScript", 300]],
    technologies: ["Deno", "grammY", "SQLite"],
    topics: [],
  });
});

Deno.test("excludes service repositories and projects without code", async () => {
  const api = new FakeAPI([
    repo("test"),
    repo("nahashed", 2),
    repo("fork-example", 3, { fork: true }),
    repo("archive-example", 4, { archived: true }),
    repo("empty-example", 5, { size: 0 }),
    repo("skeleton-example", 6),
  ]);
  equal(await collect(api), { languages: [], technologies: [], topics: [] });
  equal(api.requests.filter((path) => path.endsWith("/languages")), [
    "/repos/nahashed/skeleton-example/languages",
  ]);
  assert(!api.requests.some((path) => path.includes("contents")));
});

Deno.test("technology detection uses configuration, not descriptions or unknown dependencies", () => {
  const actual = detectTechnologies({
    "deno.json": {
      imports: { "db/postgres": "jsr:@db/postgres@^0.19.5" },
      tasks: { dev: { command: "deno run app.ts" } },
    },
    "package.json": {
      scripts: { start: "node main.js" },
      dependencies: { grammy: "^1", "better-sqlite3": "^1", [CANARY]: "1" },
    },
  });
  equal(
    [...actual].sort(),
    ["Deno", "Node.js", "grammY", "SQLite", "PostgreSQL"].sort(),
  );
  equal([
    ...detectTechnologies({
      "package.json": {
        description: "Deno SQLite PostgreSQL grammY Node.js",
        keywords: ["sqlite"],
      },
    }),
  ], []);
});

Deno.test("paginates the complete inventory and rejects missing repositories or counts", async () => {
  const api = new FakeAPI(
    Array.from({ length: 101 }, (_, i) => repo(`example-${i}`, i)),
  );
  equal(await collect(api), { languages: [], technologies: [], topics: [] });
  assert(api.requests.some((path) => path.includes("page=2")));
  await rejects(() =>
    collect({
      get: (path) =>
        path.startsWith("/user/repos?") ? Promise.resolve([]) : api.get(path),
    })
  );
  await rejects(() =>
    collect({
      get: (path) =>
        path === "/user"
          ? Promise.resolve({ login: "nahashed", public_repos: 0 })
          : Promise.resolve([]),
    })
  );
});

Deno.test("outputs contain aggregates only, unchanged data is idempotent, failures retain both assets", async () => {
  const directory = await Deno.makeTempDir();
  const root = new URL(`file://${directory}/`);
  try {
    assert(await update(example(), root));
    assert(!await update(example(), root));
    const paths = ["light", "dark"].map((theme) =>
      new URL(`assets/stack-${theme}.svg`, root)
    );
    const before = await Promise.all(
      paths.map((path) => Deno.readTextFile(path)),
    );
    for (const content of before) {
      assert(
        !content.includes(CANARY) && !content.includes("internal.invalid") &&
          !content.includes("public-example"),
      );
    }
    const api = example();
    await rejects(() =>
      update({
        get: (path) => {
          if (path === "/repos/nahashed/public-example/languages") {
            throw new ProfileError("GitHub API request failed. Retry later.");
          }
          return api.get(path);
        },
      }, root)
    );
    equal(
      await Promise.all(paths.map((path) => Deno.readTextFile(path))),
      before,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("unexpected errors do not disclose private details in logs", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (value: string) => {
    errors.push(value);
  };
  try {
    equal(
      await run(() => {
        throw new Error(CANARY);
      }),
      1,
    );
  } finally {
    console.error = original;
  }
  assert(!errors.join("").includes(CANARY));
  assert(errors.join("").includes("No API details logged"));
});

Deno.test("both SVG themes escape labels and group smaller languages", () => {
  const snapshot: Snapshot = {
    languages: ["Rust", "TypeScript", "C++", "C#", "HTML & XML", "CSS", "Shell"]
      .map((name) => [name, 10]),
    technologies: ["Deno"],
    topics: ["Bitrix", "HAProxy", "Rust"],
  };
  for (const dark of [false, true]) {
    const svg = render(snapshot, dark);
    assert(
      svg.includes("HTML &amp; XML") && svg.includes("Other") &&
        svg.includes("28.6%"),
    );
    assert(!svg.includes("<script") && !svg.includes("<foreignObject"));
    assert(
      svg.includes("FROM PROJECT TOPICS") &&
        svg.includes("Bitrix / HAProxy / Rust"),
    );
  }
  assert(render(null, false).includes("First snapshot pending."));
});

Deno.test("topics use an explicit technology allowlist and deduplicate aliases", async () => {
  equal(
    detectTopics([
      "rust",
      "Bitrix",
      "1c-bitrix",
      "statamic",
      "jenkins",
      "haproxy",
      "xray-core",
      CANARY,
      "__proto__",
    ]),
    ["Bitrix", "HAProxy", "Jenkins", "Rust", "Statamic", "Xray"],
  );
  const api = new FakeAPI([
    repo(CANARY, 1, { topics: [CANARY, "rust", "deno"] }),
  ], { [CANARY]: { Rust: 100 } });
  equal((await collect(api)).topics, ["Deno", "Rust"]);
  assert(!render(await collect(api), false).includes(CANARY));
});
