(function () {
  const article = document.querySelector("article.markdown-body");
  const commentsList = document.getElementById("comments-list");
  let pendingForm = null;

  function getNodePath(node) {
    const parts = [];
    let current = node;
    while (current && current !== article) {
      const parent = current.parentNode;
      if (!parent) break;
      const siblings = Array.from(parent.childNodes);
      parts.unshift(siblings.indexOf(current));
      current = parent;
    }
    return parts.join("/");
  }

  function resolveNodePath(pathStr) {
    if (!pathStr) return null;
    const parts = pathStr.split("/").map(Number);
    let node = article;
    for (const idx of parts) {
      if (!node || !node.childNodes[idx]) return null;
      node = node.childNodes[idx];
    }
    return node;
  }

  function applyHighlight(comment) {
    const startNode = resolveNodePath(comment.startPath);
    const endNode = resolveNodePath(comment.endPath);
    if (!startNode || !endNode) return;

    try {
      const range = document.createRange();
      range.setStart(startNode, comment.startOffset);
      range.setEnd(endNode, comment.endOffset);

      const span = document.createElement("span");
      span.className = "comment-highlight";
      span.dataset.commentId = comment.id;
      span.title = comment.comment;
      range.surroundContents(span);
    } catch {
      // range might cross element boundaries, which surroundContents can't handle
    }
  }

  function removeHighlight(id) {
    const span = article.querySelector(
      `.comment-highlight[data-comment-id="${id}"]`
    );
    if (span) {
      const parent = span.parentNode;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    }
  }

  function renderComments(comments) {
    commentsList.innerHTML = "";
    for (const c of comments) {
      const card = document.createElement("div");
      card.className = "comment-card";
      card.dataset.commentId = c.id;

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "×";
      deleteBtn.onclick = async () => {
        await fetch(`/api/comments/${c.id}`, { method: "DELETE" });
        removeHighlight(c.id);
        await loadComments();
      };

      const quoted = document.createElement("div");
      quoted.className = "quoted-text";
      quoted.textContent = c.selectedText;

      const body = document.createElement("div");
      body.className = "comment-body";
      body.textContent = c.comment;

      card.addEventListener("click", (e) => {
        if (e.target === deleteBtn) return;
        const highlight = article.querySelector(
          `.comment-highlight[data-comment-id="${c.id}"]`
        );
        if (highlight) {
          highlight.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });

      card.appendChild(deleteBtn);
      card.appendChild(quoted);
      card.appendChild(body);
      commentsList.appendChild(card);
    }
  }

  async function loadComments() {
    const res = await fetch("/api/comments");
    const comments = await res.json();

    // Remove all existing highlights before re-applying
    article.querySelectorAll(".comment-highlight").forEach((span) => {
      const parent = span.parentNode;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
    });
    article.normalize();

    for (const c of comments) {
      applyHighlight(c);
    }
    renderComments(comments);
  }

  function getSourceLine(node) {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el !== article) {
      if (el.dataset && el.dataset.sourceLine) {
        return parseInt(el.dataset.sourceLine, 10);
      }
      el = el.parentElement;
    }
    return null;
  }

  function showCommentForm(selectedText, sourceLine, startPath, startOffset, endPath, endOffset) {
    if (pendingForm) {
      pendingForm.remove();
      pendingForm = null;
    }

    const form = document.createElement("div");
    form.className = "comment-form";

    const quoted = document.createElement("div");
    quoted.className = "quoted-text";
    quoted.textContent = selectedText;

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Leave a comment...";

    const buttons = document.createElement("div");
    buttons.className = "form-buttons";

    const saveBtn = document.createElement("button");
    saveBtn.className = "save-btn";
    saveBtn.textContent = "Save";
    saveBtn.onclick = async () => {
      const comment = textarea.value.trim();
      if (!comment) return;
      await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedText,
          sourceLine,
          startPath,
          startOffset,
          endPath,
          endOffset,
          comment,
        }),
      });
      form.remove();
      pendingForm = null;
      await loadComments();
    };

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cancel-btn";
    cancelBtn.textContent = "Cancel";
    cancelBtn.onclick = () => {
      form.remove();
      pendingForm = null;
    };

    buttons.appendChild(saveBtn);
    buttons.appendChild(cancelBtn);
    form.appendChild(quoted);
    form.appendChild(textarea);
    form.appendChild(buttons);

    commentsList.prepend(form);
    textarea.focus();
    pendingForm = form;
  }

  document.addEventListener("mouseup", () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    const range = sel.getRangeAt(0);
    if (!article.contains(range.startContainer) || !article.contains(range.endContainer)) {
      return;
    }

    const selectedText = sel.toString().trim();
    if (!selectedText) return;

    const sourceLine = getSourceLine(range.startContainer);
    const startPath = getNodePath(range.startContainer);
    const startOffset = range.startOffset;
    const endPath = getNodePath(range.endContainer);
    const endOffset = range.endOffset;

    sel.removeAllRanges();
    showCommentForm(selectedText, sourceLine, startPath, startOffset, endPath, endOffset);
  });

  loadComments();
})();
