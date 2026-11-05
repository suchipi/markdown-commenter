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
| `comments-output.md` | Where comments get saved. If it already exists, its comments are loaded on startup. Anything else in it is overwritten on the first save. |
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
- Images and other files referenced with paths relative to the input file are served, so relative image links work.
- The input file is re-read on every page load, so you can edit it and refresh.

## Limitations

- Highlights are anchored to positions in the rendered page, not to the Markdown text. If you edit the input file after commenting, existing highlights may land in the wrong place or disappear. The comments themselves stay in the sidebar and in the comments file.
- A selection that crosses element boundaries (for example, starting in one paragraph and ending in the next) is saved, but it won't show a highlight in the document.
- Links in the document aren't rendered as Markdown pages. Only the input file is rendered.

## Security

This is meant for local use only. The server will serve any file your user can read when it's requested by absolute path (for example, `http://127.0.0.1:3000/etc/hosts`). By default it only listens on `127.0.0.1`, so other machines can't reach it. If you use `--host` to listen on another interface (such as `0.0.0.0`), anyone who can reach that interface can read those files, so don't do that on a network you don't trust.
