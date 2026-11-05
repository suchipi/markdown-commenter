# markdown-commenter

A small local web app for leaving review comments on a Markdown document. It renders the document in your browser with GitHub-style styling, lets you highlight text or click on images to comment on them, and saves every comment to a separate Markdown file.

## Requirements

- Node.js 20.11 or newer

## Setup

```sh
npm install
```

## Usage

```sh
node src/server.js [--host <address>] <input.md> <comments-output.md> [port]
```

| Argument             | Description                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- |
| `input.md`           | The Markdown file to review. It is never modified.                                  |
| `comments-output.md` | Where comments get saved. If it already exists, its comments are loaded on startup. Anything else in it is overwritten on the first save. A [link state file](#link-state-file) is kept next to it. |
| `port`               | Port to listen on. Defaults to `3000`.                                              |
| `--host <address>`   | Address to listen on. Defaults to `127.0.0.1`, so only this machine can connect. Use `0.0.0.0` to listen on all IPv4 interfaces, or `::` for all IPv4 and IPv6 interfaces. |

Then open `http://127.0.0.1:3000`.

To try it out on the included test documents:

```sh
node src/server.js fixtures/fixture.md .tmp/comments.md
```

## Leaving comments

- **Text:** select some text in the document. A comment form appears at the top of the sidebar. Type your comment and click Save. The text stays highlighted.
- **Images:** click anywhere on an image. A pin is dropped at that spot and a comment form opens for it.
- Click a comment in the sidebar to scroll to its highlight or pin. Clicking a pin scrolls to its comment.
- Click the × on a comment to delete it.

Every add or delete rewrites the comments file immediately.

## Comments file format

Each comment becomes a section like this, with sections separated by `---`:

```md
<!-- id: eyJpZCI6Im13Mnd6aDhhb3dwcCIsInNvdXJjZUxpbmUiOjcsInN0YXJ0UGF0aCI6IjIvMCIs... -->

# Line 7:

## Selected Content:
Neat, huh?

## Comment:
Is it, though?
```

- `# Line N:` is the starting line, in the input file, of the element the selection begins in. That's usually the paragraph or list item, so in a long paragraph it points at the top of the paragraph. It's left out if no line could be determined.
- For image comments, Selected Content reads like `Image: ./sample-image.png at (42%, 17%)`.
- The `id` comment is base64-encoded JSON holding the comment's ID and its position in the rendered page. The server uses it to restore highlights and pins when it restarts, so leave it alone if you want them to come back.

The file is only read at startup. While the server is running it holds comments in memory and overwrites the file on every change, so hand edits made in the meantime will be lost. To edit comments by hand, stop the server first.

## Rendering

- GitHub Flavored Markdown (tables, task lists, strikethrough, autolinks) via [remark](https://github.com/remarkjs/remark), with raw HTML passed through.
- Styling comes from [mark-applier](https://www.npmjs.com/package/mark-applier) and follows your system's light or dark mode.
- The input file is re-read on every page load, so you can edit it and refresh.

## Linked files

The server only serves files that a page it rendered actually references. It looks at `src`, `srcset` and `poster` attributes, `href` on `<a>`, `<area>` and `<link>`, `<object data>`, and CSS `url()` and `@import`, including `<style>` blocks and `style` attributes. Paths can be relative to the page or absolute filesystem paths (`/Users/you/Pictures/shot.png`), and folders starting with a dot work.

| Type | Extensions | Served as |
| --- | --- | --- |
| Images | png, jpg, jpeg, gif, webp, avif, svg, bmp, ico, apng, tif, tiff, heic, heif, jxl | the file |
| Video and audio | mp4, m4v, webm, mov, ogv, mp3, m4a, aac, wav, ogg, oga, opus, flac, weba, vtt | the file, with seeking support |
| Other files | pdf, js, mjs, woff, woff2, ttf, otf, eot, css, html, htm | the file |
| Markdown | md | a page rendered by mark-applier, without the commenting UI |

Anything else returns 404 even if a page references it. The type is checked on the file a symlink points to, not on the link's name.

References inside linked Markdown, HTML and CSS files are followed too, so a linked HTML page gets its stylesheets, scripts, fonts and images, and a linked Markdown page gets its images.

mark-applier rewrites links to `foo.md` and `foo` into `foo.html`. A link to `foo.html` or `foo` that has no file behind it falls back to `foo.md`. A link to the input file goes to the commenting view at `/`.

## Link state file

The server keeps `<comments-output.md>.state.json` next to the comments file. It records which linked pages have been opened and what each one references, so after a restart, links on those pages work right away instead of returning 404 until you open the page that contains them again. The server logs a line when it creates the file.

On every start, the server re-reads the input file and each page from the state file that's still linked from it. Then it drops the entries that are no longer linked and rewrites the file. You can delete it whenever you like; afterwards, the links on a linked page work again once you've opened that page.

## Limitations

- Highlights are anchored to positions in the rendered page, not to the Markdown text. If you edit the input file after commenting, existing highlights may land in the wrong place or disappear. The comments themselves stay in the sidebar and in the comments file.
- A selection that crosses element boundaries (for example, starting in one paragraph and ending in the next) is saved, but it won't show a highlight in the document.
- Only the input file can be commented on. Linked Markdown pages are rendered without the commenting UI.
- Files that a script loads at runtime aren't served. That includes ES module `import`s from a served `.js` file and `fetch()` requests; only files named directly in HTML or CSS are.
- A `<base href>` in a linked HTML page is ignored when working out what the page references.
- `image-set()` entries written as bare strings aren't followed. Use `url()` instead.
- `../` references in the input file can't reach above its folder, because the page is served at `/`. They do work from linked pages in subfolders.
- A page's references are only updated when the page is rendered. If you remove a link while the server is running, its target stays available until the server restarts.

## Security

This is meant for local use only. The server only serves files that a rendered page references, and only of the types listed under [Linked files](#linked-files), so it won't serve things like `~/.ssh/id_rsa` or `.env` files. A document can still reference any file of those types by absolute path, though, and raw HTML in it (including `<script>`) runs as part of the page.

By default the server only listens on `127.0.0.1`, so other machines can't reach it. If you use `--host` to listen on another interface (such as `0.0.0.0`), anyone who can reach that interface can view the document and everything it links to, and can add or delete comments. Don't do that on a network you don't trust.
