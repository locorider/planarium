#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import { discoverPlanningWorkspaces, planningApiPlugin } from "./server/planningApi.js";

interface CliOptions {
  root: string;
  port: number;
  host: string;
  maxDepth: number;
  readOnly: boolean;
}

function usage(): string {
  return [
    "Planarium - local .planning epic viewer",
    "",
    "Usage:",
    "  planarium [root] [--port 9010] [--host 127.0.0.1] [--depth 5] [--read-only]",
    "",
    "Options:",
    "  -r, --root <path>     Folder to scan from. Defaults to the current directory.",
    "  -p, --port <number>   Port for the local viewer. Defaults to 9010.",
    "      --host <host>     Host for the local viewer. Defaults to 127.0.0.1.",
    "      --depth <number>  Nested folder scan depth. Defaults to 5.",
    "      --read-only       Disable status, approval, claim, archive, and delete actions.",
    "  -h, --help            Show this help.",
    "",
  ].join("\n");
}

function readNumber(value: string | undefined, fallback: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    port: 9010,
    host: "127.0.0.1",
    maxDepth: 5,
    readOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "-r" || arg === "--root") {
      options.root = resolve(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (arg === "-p" || arg === "--port") {
      options.port = readNumber(argv[index + 1], options.port, "port");
      index += 1;
      continue;
    }
    if (arg === "--host") {
      options.host = argv[index + 1] ?? options.host;
      index += 1;
      continue;
    }
    if (arg === "--depth") {
      options.maxDepth = readNumber(argv[index + 1], options.maxDepth, "depth");
      index += 1;
      continue;
    }
    if (arg === "--read-only") {
      options.readOnly = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    options.root = resolve(arg);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const workspaces = discoverPlanningWorkspaces(options.root, options.maxDepth);
  const server = await createServer({
    root: packageRoot,
    configFile: false,
    appType: "spa",
    plugins: [react(), planningApiPlugin({ root: options.root, maxDepth: options.maxDepth, readOnly: options.readOnly })],
    server: {
      host: options.host,
      port: options.port,
      strictPort: false,
    },
  });

  await server.listen();
  server.printUrls();
  process.stdout.write(`\nPlanarium scanning: ${options.root}\n`);
  process.stdout.write(`Planning workspaces: ${workspaces.length}\n`);
  if (workspaces.length === 0) {
    process.stdout.write("No .planning folders found from this root yet.\n");
  }
  if (options.readOnly) {
    process.stdout.write("Running in read-only mode.\n");
  }

  const close = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void close();
  });
  process.once("SIGTERM", () => {
    void close();
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write(usage());
  process.exit(1);
});
