# Profile maintenance

## Setup and token renewal

1. Create a
   [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new).
2. Set resource owner to `nahashed`, repository access to **All repositories**,
   and an expiry appropriate for the account. The owner currently uses a token
   without expiration. For expiring tokens, 365 days is a practical default.
   This includes future owned repositories. Do not select individual
   repositories.
3. Grant repository permissions **Metadata: read** and **Contents: read** only.
4. Save it directly as the repository Actions secret
   [`PROFILE_READ_TOKEN`](https://github.com/nahashed/nahashed/settings/secrets/actions).
   Do not paste it into an issue, chat, command line, or tracked file.
5. Open
   [Update profile](https://github.com/nahashed/nahashed/actions/workflows/profile.yml)
   and use **Run workflow** on `main`. Check that the run succeeds and both SVGs
   are updated. A repeated run with unchanged data produces no commit.

Renew the token before it expires and replace the same secret. A revoked,
expired, or insufficiently authorized token fails the run and keeps the last
overview. The initial assets explicitly say that the first snapshot is pending.

The read token never publishes files. Publication uses the standard
`GITHUB_TOKEN`, with write access only to this profile repository. Tests on pull
requests do not receive the read token. Update jobs accept only the trusted
`main` branch of this repository. Actions are pinned to full commit hashes.

## Schedule

The daily schedule is `03:17 UTC`, approximately `06:17 Europe/Moscow`. GitHub
may delay scheduled jobs. Manual dispatch is available at any time.

GitHub can
[disable scheduled workflows after 60 days without repository activity](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow).
Re-enable **Update profile** in Actions when needed. Do not create fake commits
just to keep the schedule active. Enable GitHub notifications for failed Actions
runs if you want expiry and access failures brought to your attention.

## What the overview means

The generator enumerates all accessible repositories owned by `nahashed`,
including private ones. It excludes forks, archived repositories, zero-size
repositories, repositories without language statistics, `test`, and this profile
repository. It follows repository-list pagination. Any API, permission, or
malformed-data error aborts the update before output is written. Both public and
private account repository counts must match the full inventory before
exclusions. If GitHub does not expose these counts, the generator fails rather
than claiming complete coverage. **All repositories** is required. A token
limited to selected repositories is unsupported.

Language percentages sum GitHub's language byte counts across eligible
repositories. They describe code volume, not expertise, time spent, or recent
activity. The largest five languages are named, the rest appear as **Other**.
Rounded shares may not total exactly 100%. GitHub Linguist statistics can lag
behind repository changes.

Technologies come from root `deno.json` and `package.json` only. The initial
allowlist is Deno, Node.js, grammY, SQLite, and PostgreSQL. Runtime commands,
runtime requirements, and dependency identifiers determine matches. Unknown
dependencies, descriptions, and keywords do not become public labels. Nested
workspaces, `deno.jsonc`, transitive dependencies, and source-code imports are
not scanned. The absence of a technology means it was not detected, not that it
is never used.

Only generated SVG aggregates are saved. No repository inventory, raw manifest,
source code, commit history, or API response is written to files, logs, or
artifacts. The initial snapshot can reveal which languages and allowlisted
technologies are used across projects, but not their names, links, or individual
statistics.

## Repository topics

The **From project topics** section collects GitHub Topics from the same
eligible repositories. Only technology names in `TOPICS` are published. Aliases
such as `bitrix` and `1c-bitrix` merge into one label. Arbitrary topics, client
names, and internal tags are discarded. Add mappings to `TOPICS` with a focused
test to recognize more technologies. Topics are project labels, not a
proficiency claim. The static text wraps into lines, without an animated marquee
or external widget.

## Profile and appearance

The profile README uses local SVG assets with `<picture>` for light/dark themes.
It loads no third-party statistics service, scripts, trackers, or external
fonts. Edit `render` in `scripts/profile.ts` for layout and colors, then run the
trusted workflow to regenerate both themes. The accent is `#ed2207`.

The avatar, website, Telegram, and LinkedIn remain the owner's existing
identity. Biography and resume information should only be added when supplied by
the owner. The native contribution calendar is managed on the GitHub profile
under **Contribution settings → Private contributions**. It shows anonymized
private contributions without publishing repository details. No custom activity
counter is generated here.

## Checks

```sh
deno task check
deno task test
```

Tests cover aggregation, pagination, exclusions, technology detection, both SVG
themes, synthetic private-name leakage, unchanged output, and retaining the last
snapshot when an API request fails. They do not read real private repositories.
For visual changes, inspect both generated SVGs and the rendered README on
GitHub.
