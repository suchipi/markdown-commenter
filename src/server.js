import express from "express";
import fs from "fs";
import path from "path";
import { parseArgs } from "util";
import { makeCss, makePageHtml } from "mark-applier";
import { markdownToHtmlWithLineNumbers } from "./render.js";
import { cssReferences, htmlReferences } from "./referenced-files.js";

const usage =
  "Usage: node src/server.js [--host <address>] <input.md> <comments-output.md> [port]";

let cli;
try {
  cli = parseArgs({
    allowPositionals: true,
    options: { host: { type: "string", default: "127.0.0.1" } },
  });
} catch (err) {
  console.error(err.message);
  console.error(usage);
  process.exit(1);
}

const args = cli.positionals;
if (args.length < 2) {
  console.error(usage);
  process.exit(1);
}

const inputFile = path.resolve(args[0]);
const outputFile = path.resolve(args[1]);
const inputDir = path.dirname(inputFile);
const port = parseInt(args[2] || "3000", 10);
const host = cli.values.host;

if (!fs.existsSync(inputFile)) {
  console.error(`Input file not found: ${inputFile}`);
  process.exit(1);
}
const inputRealPath = fs.realpathSync.native(inputFile);

let comments = [];
if (fs.existsSync(outputFile)) {
  try {
    const raw = fs.readFileSync(outputFile, "utf-8");
    const parsed = parseCommentsFile(raw);
    if (parsed.length > 0) {
      comments = parsed;
    }
  } catch {
    // start fresh if the file can't be parsed
  }
}

function parseCommentsFile(text) {
  const results = [];
  const blocks = text.split(/^---$/m);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const idMatch = trimmed.match(/^<!-- id: (.+) -->$/m);
    if (!idMatch) continue;

    const data = JSON.parse(
      Buffer.from(idMatch[1], "base64").toString("utf-8"),
    );

    const contentMarker = trimmed.indexOf("\n## Selected Content:\n");
    const commentMarker = trimmed.indexOf("\n## Comment:\n");
    const selectedText = contentMarker !== -1 && commentMarker !== -1
      ? trimmed.slice(contentMarker + "\n## Selected Content:\n".length, commentMarker)
      : "";
    const comment = commentMarker !== -1
      ? trimmed.slice(commentMarker + "\n## Comment:\n".length).trim()
      : "";

    results.push({
      id: data.id,
      selectedText,
      sourceLine: data.sourceLine ?? null,
      startPath: data.startPath,
      startOffset: data.startOffset,
      endPath: data.endPath,
      endOffset: data.endOffset,
      imageX: data.imageX ?? null,
      imageY: data.imageY ?? null,
      comment,
    });
  }
  return results;
}

function writeCommentsFile() {
  const sections = comments.map((c) => {
    const data = Buffer.from(
      JSON.stringify({
        id: c.id,
        sourceLine: c.sourceLine,
        startPath: c.startPath,
        startOffset: c.startOffset,
        endPath: c.endPath,
        endOffset: c.endOffset,
        imageX: c.imageX,
        imageY: c.imageY,
      }),
    ).toString("base64");
    const lineLabel = c.sourceLine != null ? `\n\n# Line ${c.sourceLine}:` : "";
    return `<!-- id: ${data} -->${lineLabel}\n\n## Selected Content:\n${c.selectedText}\n\n## Comment:\n${c.comment}`;
  });
  fs.writeFileSync(outputFile, sections.join("\n\n---\n\n") + "\n");
}

const stateFile = outputFile + ".state.json";
const serverUrl = `http://${urlHostFor(host)}:${port}`;
const inputPage = { file: inputRealPath, kind: "markdown" };
const refsByPage = new Map();
let savedStateJson = null;

function loadVisitedPages() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch {
    return new Set();
  }
  if (state?.version !== 1 || state.input !== inputRealPath) return new Set();
  return new Set(Object.keys(state.pages ?? {}));
}

function saveState() {
  const pages = {};
  for (const [urlPath, page] of refsByPage) {
    pages[urlPath] = {
      file: page.file,
      kind: page.kind,
      refs: Object.fromEntries(page.refs),
    };
  }
  const json =
    JSON.stringify({ version: 1, input: inputRealPath, pages }, null, 2) + "\n";
  if (json === savedStateJson) return;
  const existed = fs.existsSync(stateFile);
  fs.writeFileSync(stateFile, json);
  savedStateJson = json;
  if (!existed) console.log(`Created link state file: ${stateFile}`);
}

async function renderPage(urlPath, target) {
  const text = fs.readFileSync(target.file, "utf-8");
  if (target.kind === "css") {
    return { type: "css", body: text, refs: cssReferences(text, urlPath, inputDir) };
  }
  let body = text;
  if (target.file === inputRealPath) {
    body = await renderCommentingPage(text);
  } else if (target.kind === "markdown") {
    body = await makePageHtml(text, { origin: serverUrl });
  }
  return { type: "html", body, refs: htmlReferences(body, urlPath, inputDir) };
}

async function renderAndRecord(urlPath, target) {
  const page = await renderPage(urlPath, target);
  refsByPage.set(urlPath, { ...target, refs: page.refs });
  saveState();
  return page;
}

function findTarget(urlPath) {
  for (const page of refsByPage.values()) {
    const target = page.refs.get(urlPath);
    if (target) return target;
  }
  return null;
}

async function crawlVisitedPages() {
  const visited = loadVisitedPages();
  const queue = [["/", inputPage]];
  while (queue.length > 0) {
    const [urlPath, target] = queue.shift();
    if (refsByPage.has(urlPath)) continue;
    let refs;
    try {
      ({ refs } = await renderPage(urlPath, target));
    } catch (err) {
      console.warn(`Couldn't render ${urlPath} at startup: ${err.message}`);
      continue;
    }
    refsByPage.set(urlPath, { ...target, refs });
    for (const [refPath, refTarget] of refs) {
      const isPage = refTarget.kind !== "file" && refTarget.file !== inputRealPath;
      if (isPage && visited.has(refPath)) queue.push([refPath, refTarget]);
    }
  }
}

async function renderCommentingPage(markdown) {
  const rawHtml = await markdownToHtmlWithLineNumbers(markdown);
  const css = makeCss("auto");
  const clientJs = fs.readFileSync(
    path.join(import.meta.dirname, "client.js"),
    "utf-8",
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Markdown Commenter</title>
  <style>${css}</style>
  <style>
    .comment-highlight {
      background: rgba(255, 212, 0, 0.3);
      cursor: pointer;
      border-radius: 2px;
    }
    .comment-highlight:hover {
      background: rgba(255, 212, 0, 0.5);
    }
    .comment-sidebar {
      position: fixed;
      top: 0;
      right: 0;
      width: 350px;
      height: 100%;
      background: #fff;
      border-left: 1px solid #ddd;
      overflow-y: auto;
      padding: 16px;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 14px;
      z-index: 1000;
    }
    @media (prefers-color-scheme: dark) {
      .comment-sidebar {
        background: #1c1c1c;
        border-left-color: #444;
        color: #e0e0e0;
      }
    }
    .comment-sidebar h3 {
      margin-top: 0;
      font-size: 16px;
    }
    .comment-card {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 10px;
      cursor: pointer;
    }
    .comment-card.flash {
      border-color: rgba(0, 120, 255, 0.9);
      background: rgba(0, 120, 255, 0.1);
    }
    @media (prefers-color-scheme: dark) {
      .comment-card {
        border-color: #444;
      }
    }
    .comment-card .quoted-text {
      font-style: italic;
      color: #666;
      border-left: 3px solid #ddd;
      padding-left: 8px;
      margin-bottom: 6px;
    }
    @media (prefers-color-scheme: dark) {
      .comment-card .quoted-text {
        color: #999;
        border-left-color: #555;
      }
    }
    .comment-card .comment-body {
      white-space: pre-wrap;
    }
    .comment-card .delete-btn {
      float: right;
      cursor: pointer;
      color: #999;
      border: none;
      background: none;
      font-size: 16px;
      padding: 0;
      line-height: 1;
    }
    .comment-card .delete-btn:hover {
      color: #d00;
    }
    .comment-form {
      border: 1px solid #ddd;
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 10px;
    }
    @media (prefers-color-scheme: dark) {
      .comment-form {
        border-color: #444;
      }
    }
    .comment-form textarea {
      width: 100%;
      min-height: 60px;
      box-sizing: border-box;
      margin-bottom: 6px;
      font-family: inherit;
      font-size: 13px;
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 6px;
    }
    @media (prefers-color-scheme: dark) {
      .comment-form textarea {
        background: #2a2a2a;
        color: #e0e0e0;
        border-color: #555;
      }
    }
    .comment-form .form-buttons {
      display: flex;
      gap: 6px;
    }
    .comment-form button {
      padding: 4px 12px;
      border-radius: 4px;
      border: 1px solid #ccc;
      cursor: pointer;
      font-size: 13px;
    }
    .comment-form .save-btn {
      background: #2ea44f;
      color: #fff;
      border-color: #2ea44f;
    }
    .comment-form .cancel-btn {
      background: transparent;
    }
    @media (prefers-color-scheme: dark) {
      .comment-form .cancel-btn {
        color: #e0e0e0;
        border-color: #555;
      }
    }
    .markdown-body {
      margin-right: 370px;
    }
    .image-comment-wrapper {
      position: relative;
      display: inline-block;
    }
    .image-comment-pin {
      position: absolute;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: rgba(255, 70, 70, 0.85);
      border: 2px solid #fff;
      transform: translate(-50%, -50%);
      cursor: pointer;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      z-index: 10;
    }
    .image-comment-pin:hover {
      background: rgba(255, 30, 30, 1);
    }
    .image-comment-pin.flash {
      background: rgba(0, 120, 255, 0.9);
    }
  </style>
</head>
<body>
  <article class="markdown-body">
    ${rawHtml}
  </article>
  <div class="comment-sidebar" id="sidebar">
    <h3>Comments</h3>
    <div id="comments-list"></div>
  </div>
  <script>${clientJs}</script>
</body>
</html>`;
}

const app = express();
app.use(express.json());

app.get("/", async (_req, res) => {
  const page = await renderAndRecord("/", inputPage);
  res.type("html").send(page.body);
});

app.get("/api/comments", (_req, res) => {
  res.json(comments);
});

app.post("/api/comments", (req, res) => {
  const comment = req.body;
  comment.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  comments.push(comment);
  writeCommentsFile();
  res.json(comment);
});

app.delete("/api/comments/:id", (req, res) => {
  comments = comments.filter((c) => c.id !== req.params.id);
  writeCommentsFile();
  res.json({ ok: true });
});

app.use(async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  const target = findTarget(req.path);
  if (!target) return next();
  if (target.kind === "file") {
    res.sendFile(target.file, { dotfiles: "allow" }, (err) => {
      if (err && !res.headersSent) next();
    });
    return;
  }
  if (target.file === inputRealPath) return res.redirect("/");
  const page = await renderAndRecord(req.path, target);
  res.type(page.type).send(page.body);
});

await crawlVisitedPages();
saveState();

function urlHostFor(address) {
  // The unspecified addresses aren't meant to be connected to; localhost reaches either.
  if (address === "0.0.0.0" || address === "::") return "localhost";
  return address.includes(":") ? `[${address}]` : address;
}

const server = app.listen(port, host, () => {
  console.log(`Markdown Commenter running at ${serverUrl}`);
  console.log(`Input:  ${inputFile}`);
  console.log(`Output: ${outputFile}`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
