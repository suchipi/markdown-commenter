import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import { visit } from "unist-util-visit";

function rehypeSourceLines() {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (node.position?.start?.line) {
        node.properties = node.properties || {};
        node.properties["dataSourceLine"] = node.position.start.line;
      }
    });
  };
}

// mark-applier lays out headings with flex row-reverse, which reverses every
// text node and inline element unless the content is one flex item.
function rehypeWrapHeadingContent() {
  return (tree) => {
    visit(tree, "element", (node) => {
      if (/^h[1-6]$/.test(node.tagName)) {
        node.children = [
          {
            type: "element",
            tagName: "span",
            properties: {},
            children: node.children,
          },
        ];
      }
    });
  };
}

export async function markdownToHtmlWithLineNumbers(input) {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeSlug)
    .use(rehypeWrapHeadingContent)
    .use(rehypeAutolinkHeadings, { behavior: "append" })
    .use(rehypeSourceLines)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(input);

  return result.toString();
}
