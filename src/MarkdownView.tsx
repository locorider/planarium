import type { ReactNode } from "react";

interface MarkdownViewProps {
  source: string;
  onOpenFile?: (path: string) => void;
}

interface MarkdownBlock {
  kind: "heading" | "paragraph" | "list" | "blockquote" | "table" | "code" | "rule";
  level?: 2 | 3 | 4;
  text?: string;
  ordered?: boolean;
  items?: string[];
  rows?: string[][];
  language?: string;
}

function isSpecialLine(line: string, nextLine?: string): boolean {
  return Boolean(
    /^#{1,4}\s+/.test(line)
      || /^---+$/.test(line.trim())
      || /^>\s?/.test(line)
      || /^\s*[-*]\s+/.test(line)
      || /^\s*\d+\.\s+/.test(line)
      || /^```/.test(line)
      || (/^\|/.test(line) && nextLine && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(nextLine)),
  );
}

function stripFirstTitle(blocks: MarkdownBlock[]): MarkdownBlock[] {
  const [first, ...rest] = blocks;
  if (first?.kind === "heading" && first.level === 2 && first.text?.startsWith("EPIC-")) {
    return rest;
  }
  return blocks;
}

function parseCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const language = line.replace(/^```/, "").trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index] ?? "")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", text: code.join("\n"), language });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const rawLevel = heading[1]?.length ?? 2;
      const level = Math.min(4, Math.max(2, rawLevel + 1)) as 2 | 3 | 4;
      blocks.push({ kind: "heading", level, text: heading[2]?.trim() ?? "" });
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoted.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "blockquote", text: quoted.join("\n").trim() });
      continue;
    }

    if (/^\|/.test(line) && nextLine && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(nextLine)) {
      const rows: string[][] = [parseCells(line)];
      index += 2;
      while (index < lines.length && /^\|/.test(lines[index] ?? "")) {
        rows.push(parseCells(lines[index] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "table", rows });
      continue;
    }

    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      const isOrdered = Boolean(ordered);
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index] ?? "";
        const match = isOrdered ? candidate.match(/^\s*\d+\.\s+(.+)$/) : candidate.match(/^\s*[-*]\s+(.+)$/);
        if (!match) {
          break;
        }
        items.push(match[1]?.trim() ?? "");
        index += 1;
      }
      blocks.push({ kind: "list", ordered: isOrdered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      if (!candidate.trim() || isSpecialLine(candidate, lines[index + 1])) {
        break;
      }
      paragraph.push(candidate.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return stripFirstTitle(blocks);
}

function firstInlineToken(text: string): { index: number; kind: "code" | "bold" | "italic" | "link"; match: RegExpMatchArray } | null {
  const tokens: Array<{ kind: "code" | "bold" | "italic" | "link"; match: RegExpMatchArray | null }> = [
    { kind: "code", match: text.match(/`([^`]+)`/) },
    { kind: "bold", match: text.match(/\*\*([^*]+)\*\*/) },
    { kind: "italic", match: text.match(/(^|[^*])\*([^*]+)\*/) },
    { kind: "link", match: text.match(/\[([^\]]+)\]\(([^)]+)\)/) },
  ];
  const found = tokens
    .filter((token): token is { kind: "code" | "bold" | "italic" | "link"; match: RegExpMatchArray } => token.match !== null)
    .map((token) => ({ ...token, index: token.match.index ?? text.length }))
    .sort((a, b) => a.index - b.index);
  return found[0] ?? null;
}

function sourcePathFromInline(value: string): string | null {
  const clean = value.trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[),.;]+$/g, "")
    .replace(/:(\d+)(:\d+)?$/, "");
  if (!clean.includes("/") || /^https?:\/\//.test(clean) || /\s/.test(clean) || clean.startsWith("../") || clean.startsWith("/")) {
    return null;
  }
  if (!/\.[a-z0-9]+$/i.test(clean)) {
    return null;
  }
  return clean;
}

function inline(text: string, keyPrefix: string, onOpenFile?: (path: string) => void): ReactNode[] {
  const token = firstInlineToken(text);
  if (!token) {
    return [text];
  }

  const before = text.slice(0, token.index);
  const matched = token.match[0] ?? "";
  const after = text.slice(token.index + matched.length);
  const nodes: ReactNode[] = [];
  if (before) {
    nodes.push(before);
  }

  const key = `${keyPrefix}-${token.index}-${token.kind}`;
  if (token.kind === "code") {
    const value = token.match[1] ?? "";
    const sourcePath = sourcePathFromInline(value);
    nodes.push(sourcePath && onOpenFile ? (
      <button key={key} className="inline-file-link" type="button" onClick={() => onOpenFile(sourcePath)}>
        <code>{value}</code>
      </button>
    ) : (
      <code key={key}>{value}</code>
    ));
  } else if (token.kind === "bold") {
    nodes.push(<strong key={key}>{inline(token.match[1] ?? "", `${key}-bold`, onOpenFile)}</strong>);
  } else if (token.kind === "italic") {
    const prefix = token.match[1] ?? "";
    const value = token.match[2] ?? "";
    if (prefix) {
      nodes.push(prefix);
    }
    nodes.push(<em key={key}>{inline(value, `${key}-italic`, onOpenFile)}</em>);
  } else {
    nodes.push(
      <a key={key} href={token.match[2]} target="_blank" rel="noreferrer">
        {inline(token.match[1] ?? "", `${key}-link`, onOpenFile)}
      </a>,
    );
  }

  nodes.push(...inline(after, `${keyPrefix}-rest-${token.index}`, onOpenFile));
  return nodes;
}

export function MarkdownView({ source, onOpenFile }: MarkdownViewProps) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) {
    return <p className="muted">No markdown summary yet.</p>;
  }

  return (
    <div className="markdown-view">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "heading") {
          const Heading = block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4";
          return <Heading key={key}>{inline(block.text ?? "", key, onOpenFile)}</Heading>;
        }
        if (block.kind === "paragraph") {
          return <p key={key}>{inline(block.text ?? "", key, onOpenFile)}</p>;
        }
        if (block.kind === "blockquote") {
          return <blockquote key={key}>{inline(block.text ?? "", key, onOpenFile)}</blockquote>;
        }
        if (block.kind === "rule") {
          return <hr key={key} />;
        }
        if (block.kind === "code") {
          return (
            <pre key={key}>
              {block.language ? <span>{block.language}</span> : null}
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "table") {
          const [head = [], ...rows] = block.rows ?? [];
          return (
            <div className="markdown-table-wrap" key={key}>
              <table>
                <thead>
                  <tr>
                    {head.map((cell) => (
                      <th key={cell}>{inline(cell, `${key}-head-${cell}`, onOpenFile)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td key={`${key}-cell-${rowIndex}-${cellIndex}`}>{inline(cell, `${key}-cell-${rowIndex}-${cellIndex}`, onOpenFile)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        const items = block.items ?? [];
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={key}>
            {items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`, onOpenFile)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
