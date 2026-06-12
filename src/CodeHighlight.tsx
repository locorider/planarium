type TokenTone =
  | "attr"
  | "comment"
  | "constant"
  | "function"
  | "keyword"
  | "number"
  | "operator"
  | "property"
  | "punctuation"
  | "string"
  | "tag"
  | "text";

interface CodeToken {
  text: string;
  tone: TokenTone;
}

const SCRIPT_KEYWORDS = new Set([
  "abstract",
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "constructor",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "finally",
  "for",
  "from",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "let",
  "new",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "satisfies",
  "set",
  "static",
  "switch",
  "throw",
  "try",
  "type",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

const CONSTANTS = new Set(["false", "Infinity", "NaN", "null", "true", "undefined"]);

function splitComment(line: string, marker: string): [string, string] {
  const index = line.indexOf(marker);
  if (index === -1) {
    return [line, ""];
  }
  return [line.slice(0, index), line.slice(index)];
}

function consumeQuoted(text: string, start: number): number {
  const quote = text[start];
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") {
      index += 2;
      continue;
    }
    if (text[index] === quote) {
      return index + 1;
    }
    index += 1;
  }
  return text.length;
}

function tokenizeWords(text: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? "";
    if (char === "\"" || char === "'" || char === "`") {
      const end = consumeQuoted(text, index);
      tokens.push({ text: text.slice(index, end), tone: "string" });
      index = end;
      continue;
    }
    const number = text.slice(index).match(/^\b\d+(?:\.\d+)?(?:n|px|rem|em|%|s|ms)?\b/);
    if (number) {
      tokens.push({ text: number[0], tone: "number" });
      index += number[0].length;
      continue;
    }
    const word = text.slice(index).match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const value = word[0];
      const after = text.slice(index + value.length).trimStart();
      const tone = SCRIPT_KEYWORDS.has(value)
        ? "keyword"
        : CONSTANTS.has(value)
          ? "constant"
          : after.startsWith("(")
            ? "function"
            : "text";
      tokens.push({ text: value, tone });
      index += value.length;
      continue;
    }
    const operator = text.slice(index).match(/^(=>|===|!==|==|!=|<=|>=|\+\+|--|\?\?|\|\||&&|[{}()[\].,;:?+\-*/%=&|!<>])/);
    if (operator) {
      tokens.push({ text: operator[0], tone: /[{}()[\].,;]/.test(operator[0]) ? "punctuation" : "operator" });
      index += operator[0].length;
      continue;
    }
    tokens.push({ text: char, tone: "text" });
    index += 1;
  }
  return tokens;
}

function tokenizeScript(line: string): CodeToken[] {
  const blockComment = line.match(/^(.*?)(\/\*.*\*\/)(.*)$/);
  if (blockComment) {
    return [
      ...tokenizeWords(blockComment[1] ?? ""),
      { text: blockComment[2] ?? "", tone: "comment" },
      ...tokenizeWords(blockComment[3] ?? ""),
    ];
  }
  const [code, comment] = splitComment(line, "//");
  return [...tokenizeWords(code), ...(comment ? [{ text: comment, tone: "comment" } satisfies CodeToken] : [])];
}

function tokenizeJson(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let index = 0;
  while (index < line.length) {
    const key = line.slice(index).match(/^(\s*)"([^"]+)"(\s*:)/);
    if (key) {
      tokens.push({ text: key[1] ?? "", tone: "text" });
      tokens.push({ text: `"${key[2] ?? ""}"`, tone: "property" });
      tokens.push({ text: key[3] ?? "", tone: "punctuation" });
      index += key[0].length;
      continue;
    }
    const value = line.slice(index);
    if (value[0] === "\"") {
      const end = consumeQuoted(line, index);
      tokens.push({ text: line.slice(index, end), tone: "string" });
      index = end;
      continue;
    }
    const constant = value.match(/^(true|false|null)\b/);
    if (constant) {
      tokens.push({ text: constant[0], tone: "constant" });
      index += constant[0].length;
      continue;
    }
    const number = value.match(/^-?\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ text: number[0], tone: "number" });
      index += number[0].length;
      continue;
    }
    tokens.push({ text: line[index] ?? "", tone: /[{}[\],:]/.test(line[index] ?? "") ? "punctuation" : "text" });
    index += 1;
  }
  return tokens;
}

function tokenizeYaml(line: string): CodeToken[] {
  const [code, comment] = splitComment(line, "#");
  const keyMatch = code.match(/^(\s*-?\s*)([A-Za-z0-9_.-]+)(\s*:)(.*)$/);
  if (!keyMatch) {
    return [...tokenizeWords(code), ...(comment ? [{ text: comment, tone: "comment" } satisfies CodeToken] : [])];
  }
  return [
    { text: keyMatch[1] ?? "", tone: "text" },
    { text: keyMatch[2] ?? "", tone: "property" },
    { text: keyMatch[3] ?? "", tone: "punctuation" },
    ...tokenizeWords(keyMatch[4] ?? ""),
    ...(comment ? [{ text: comment, tone: "comment" } satisfies CodeToken] : []),
  ];
}

function tokenizeCss(line: string): CodeToken[] {
  if (/^\s*\/\*/.test(line) || /\*\/\s*$/.test(line)) {
    return [{ text: line, tone: "comment" }];
  }
  const property = line.match(/^(\s*)(--?[A-Za-z0-9_-]+)(\s*:)(.*)$/);
  if (property) {
    return [
      { text: property[1] ?? "", tone: "text" },
      { text: property[2] ?? "", tone: "property" },
      { text: property[3] ?? "", tone: "punctuation" },
      ...tokenizeWords(property[4] ?? ""),
    ];
  }
  const atRule = line.match(/^(\s*)(@[A-Za-z-]+)(.*)$/);
  if (atRule) {
    return [
      { text: atRule[1] ?? "", tone: "text" },
      { text: atRule[2] ?? "", tone: "keyword" },
      ...tokenizeWords(atRule[3] ?? ""),
    ];
  }
  return tokenizeWords(line);
}

function tokenizeAttributes(attrs: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const pattern = /([A-Za-z_:.-]+)(=)("[^"]*"|'[^']*')/g;
  let lastIndex = 0;
  for (const match of attrs.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ text: attrs.slice(lastIndex, index), tone: "text" });
    }
    tokens.push({ text: match[1] ?? "", tone: "attr" });
    tokens.push({ text: match[2] ?? "", tone: "operator" });
    tokens.push({ text: match[3] ?? "", tone: "string" });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < attrs.length) {
    tokens.push({ text: attrs.slice(lastIndex), tone: "text" });
  }
  return tokens;
}

function tokenizeMarkup(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  const pattern = /(<!--.*?-->)|(<\/?)([A-Za-z][\w:-]*)([^>]*)(\/?>)/g;
  let lastIndex = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, index), tone: "text" });
    }
    if (match[1]) {
      tokens.push({ text: match[1], tone: "comment" });
    } else {
      tokens.push({ text: match[2] ?? "", tone: "punctuation" });
      tokens.push({ text: match[3] ?? "", tone: "tag" });
      tokens.push(...tokenizeAttributes(match[4] ?? ""));
      tokens.push({ text: match[5] ?? "", tone: "punctuation" });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex), tone: "text" });
  }
  return tokens.length > 0 ? tokens : tokenizeWords(line);
}

function tokenizeMarkdown(line: string): CodeToken[] {
  if (/^\s*#{1,6}\s/.test(line)) {
    return [{ text: line, tone: "keyword" }];
  }
  if (/^\s*>/.test(line)) {
    return [{ text: line, tone: "comment" }];
  }
  return tokenizeWords(line);
}

function tokenizeShell(line: string): CodeToken[] {
  const [code, comment] = splitComment(line, "#");
  const tokens = tokenizeWords(code).map((token) => {
    if (/^(cd|cp|curl|docker|echo|export|git|grep|mkdir|mv|node|npm|pnpm|rm|sed|test|yarn)$/.test(token.text)) {
      return { ...token, tone: "function" as const };
    }
    return token;
  });
  return [...tokens, ...(comment ? [{ text: comment, tone: "comment" } satisfies CodeToken] : [])];
}

function tokenizeLine(line: string, language: string): CodeToken[] {
  const normalized = language.toLowerCase();
  if (["html", "xml", "svg"].includes(normalized)) {
    return tokenizeMarkup(line);
  }
  if (["css", "scss", "less"].includes(normalized)) {
    return tokenizeCss(line);
  }
  if (["json", "jsonc"].includes(normalized)) {
    return tokenizeJson(line);
  }
  if (["yaml", "yml"].includes(normalized)) {
    return tokenizeYaml(line);
  }
  if (["markdown", "md"].includes(normalized)) {
    return tokenizeMarkdown(line);
  }
  if (["bash", "sh", "shell", "zsh"].includes(normalized)) {
    return tokenizeShell(line);
  }
  return tokenizeScript(line);
}

export function HighlightedCodeLine({ language, line }: { language: string; line: string }) {
  const tokens = tokenizeLine(line, language);
  return (
    <>
      {tokens.map((token, index) => (
        <span className={`code-token code-token--${token.tone}`} key={`${index}-${token.text}`}>
          {token.text}
        </span>
      ))}
    </>
  );
}
