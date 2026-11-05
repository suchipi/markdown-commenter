import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fromHtml } from "hast-util-from-html";
import { visit } from "unist-util-visit";
import * as csstree from "css-tree";

const EXTENSIONS_BY_KIND = {
  file: [
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".bmp", ".ico",
    ".apng", ".tif", ".tiff", ".heic", ".heif", ".jxl",
    ".mp4", ".m4v", ".webm", ".mov", ".ogv",
    ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac", ".weba",
    ".vtt", ".pdf", ".js", ".mjs",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ],
  css: [".css"],
  html: [".html", ".htm"],
  markdown: [".md"],
};

const KIND_BY_EXTENSION = new Map(
  Object.entries(EXTENSIONS_BY_KIND).flatMap(([kind, extensions]) =>
    extensions.map((extension) => [extension, kind]),
  ),
);

const PAGE_ORIGIN = "http://page.invalid";

export function htmlReferences(html, pageUrlPath, inputDir) {
  return resolveReferences(htmlReferenceValues(html), pageUrlPath, inputDir);
}

export function cssReferences(css, pageUrlPath, inputDir) {
  return resolveReferences(
    cssReferenceValues(css, "stylesheet"),
    pageUrlPath,
    inputDir,
  );
}

function htmlReferenceValues(html) {
  const values = [];
  visit(fromHtml(html), "element", (node) => {
    const { src, srcSet, poster, href, data, style } = node.properties;
    if (typeof src === "string") values.push(src);
    if (typeof poster === "string") values.push(poster);
    if (typeof srcSet === "string") {
      for (const candidate of srcSet.split(",")) {
        values.push(candidate.trim().split(/\s+/)[0]);
      }
    }
    if (typeof href === "string" && ["a", "area", "link"].includes(node.tagName)) {
      values.push(href);
    }
    if (typeof data === "string" && node.tagName === "object") values.push(data);
    if (typeof style === "string") {
      values.push(...cssReferenceValues(style, "declarationList"));
    }
    if (node.tagName === "style") {
      const text = node.children.map((child) => child.value ?? "").join("");
      values.push(...cssReferenceValues(text, "stylesheet"));
    }
  });
  return values;
}

function cssReferenceValues(css, context) {
  const values = [];
  csstree.walk(csstree.parse(css, { context }), (node) => {
    if (node.type === "Url") {
      values.push(node.value);
    } else if (node.type === "Atrule" && node.name.toLowerCase() === "import") {
      const first = node.prelude?.children?.first;
      if (first?.type === "String") values.push(first.value);
    }
  });
  return values;
}

function resolveReferences(values, pageUrlPath, inputDir) {
  const pageUrl = new URL(pageUrlPath, PAGE_ORIGIN);
  const refs = new Map();
  const seen = new Set();
  for (const value of values) {
    let url;
    try {
      url = new URL(value, pageUrl);
    } catch {
      continue;
    }
    if (url.origin !== pageUrl.origin || seen.has(url.pathname)) continue;
    seen.add(url.pathname);
    const target = resolveTarget(url.pathname, inputDir);
    if (target) refs.set(url.pathname, target);
  }
  return refs;
}

function resolveTarget(urlPath, inputDir) {
  let decoded;
  try {
    decoded = fileURLToPath(new URL(urlPath, "file:///"));
  } catch {
    return null;
  }
  const candidates = [path.join(inputDir, decoded), decoded];
  const extension = path.extname(decoded).toLowerCase();
  // mark-applier rewrites links to `foo.md` and `foo` into `foo.html`.
  if (extension === ".html" || extension === "") {
    const markdownPath =
      decoded.slice(0, decoded.length - extension.length) + ".md";
    candidates.push(path.join(inputDir, markdownPath), markdownPath);
  }
  for (const candidate of candidates) {
    const target = classify(candidate);
    if (target) return target;
  }
  return null;
}

function classify(candidate) {
  let file;
  try {
    file = fs.realpathSync.native(candidate);
    if (!fs.statSync(file).isFile()) return null;
    fs.accessSync(file, fs.constants.R_OK);
  } catch {
    return null;
  }
  const kind = KIND_BY_EXTENSION.get(path.extname(file).toLowerCase());
  return kind ? { file, kind } : null;
}
