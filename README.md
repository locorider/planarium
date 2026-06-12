# Planarium

Planarium is a local web viewer for `.planning` epic folders. It was extracted
from the Cadenry planning dashboard so it can run beside any repository without
becoming part of that repository.

## Run

From a project or parent folder:

```bash
npx planarium
```

Or point it at another tree:

```bash
npx planarium --root /path/to/workspace --port 9010
```

From a local checkout:

```bash
npx /Users/neo/epic-viewer --root /path/to/workspace
```

From GitHub, once this repository is pushed:

```bash
npx github:<user-or-org>/epic-viewer --root /path/to/workspace
```

Planarium scans downward from the root and includes every nested folder that has
a `.planning` directory. That makes it useful for parent folders where each
subfolder is a standalone service.

## CLI

```bash
planarium [root] [--port 9010] [--host 127.0.0.1] [--depth 5] [--read-only]
```

- `root`: folder to scan from; defaults to the current directory.
- `--port`: local viewer port; defaults to `9010`.
- `--host`: local bind host; defaults to `127.0.0.1`.
- `--depth`: nested folder scan depth; defaults to `5`.
- `--read-only`: disables status, approval, claim, archive, and delete actions.

## Planning Format

Planarium expects epic directories like:

```text
.planning/
  EPIC-0001-example/
    epic.yaml
    claim.yaml
    summary.md
```

It reads:

- `epic.yaml`: id, title, slug, status, timestamps, approval, change surface,
  behavior scenarios, risks, and user stories.
- `claim.yaml`: holder, heartbeat, expiration, and intent.
- `summary.md`: drawer summary rendered as lightweight markdown.
- `.github-sync.json`: optional GitHub issue mirror metadata.

## Optional Config

Create `.planning/planarium.json` to name a workspace or define custom areas:

```json
{
  "name": "API Service",
  "areas": {
    "Backend": ["EPIC-0001", "EPIC-0002"],
    "Operations": ["EPIC-0003"]
  },
  "areaDescriptions": {
    "Backend": "HTTP surface, persistence, jobs, and domain behavior.",
    "Operations": "Deployment, observability, and maintenance work."
  }
}
```

If an epic has a top-level `area:` or `milestone:` field in `epic.yaml`, that
value wins over the config.

## Local Development

```bash
npm install
npm run dev
npm test
npm run build
```

For local development against another project:

```bash
PLANARIUM_ROOT=/path/to/project npm run dev
```
