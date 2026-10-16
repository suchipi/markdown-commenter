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
      if (parent.classList && parent.classList.contains("image-comment-wrapper")) {
        current = parent;
        continue;
      }
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
    if (comment.imageX != null) {
      applyImagePin(comment);
      return;
    }

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

  function ensureImageWrapper(img) {
    if (img.parentElement.classList.contains("image-comment-wrapper")) {
      return img.parentElement;
    }
    const wrapper = document.createElement("span");
    wrapper.className = "image-comment-wrapper";
    img.parentNode.insertBefore(wrapper, img);
    wrapper.appendChild(img);
    return wrapper;
  }

  function applyImagePin(comment) {
    let imgNode = resolveNodePath(comment.startPath);
    if (!imgNode) return;
    if (imgNode.classList && imgNode.classList.contains("image-comment-wrapper")) {
      imgNode = imgNode.querySelector("img");
    }
    if (!imgNode || imgNode.tagName !== "IMG") return;

    const wrapper = ensureImageWrapper(imgNode);
    const pin = document.createElement("span");
    pin.className = "image-comment-pin";
    pin.dataset.commentId = comment.id;
    pin.title = comment.comment;
    pin.style.left = comment.imageX + "%";
    pin.style.top = comment.imageY + "%";
    wrapper.appendChild(pin);
  }

  function removeHighlight(id) {
    const pin = article.querySelector(
      `.image-comment-pin[data-comment-id="${id}"]`
    );
    if (pin) {
      pin.remove();
      return;
    }

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
        const target = article.querySelector(
          `.comment-highlight[data-comment-id="${c.id}"], .image-comment-pin[data-comment-id="${c.id}"]`
        );
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.classList.add("flash");
          setTimeout(() => target.classList.remove("flash"), 800);
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

    article.querySelectorAll(".image-comment-pin").forEach((pin) => pin.remove());
    article.querySelectorAll(".image-comment-wrapper").forEach((wrapper) => {
      const img = wrapper.querySelector("img");
      if (img) {
        wrapper.parentNode.insertBefore(img, wrapper);
      }
      wrapper.remove();
    });
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

  article.addEventListener("click", (e) => {
    if (e.target.tagName !== "IMG") return;
    const img = e.target;
    const rect = img.getBoundingClientRect();
    const imageX = ((e.clientX - rect.left) / rect.width) * 100;
    const imageY = ((e.clientY - rect.top) / rect.height) * 100;
    const imgSrc = img.getAttribute("src");
    const sourceLine = getSourceLine(img);
    const imgPath = getNodePath(img);

    showImageCommentForm(imgSrc, imageX, imageY, sourceLine, imgPath);
  });

  function showImageCommentForm(imgSrc, imageX, imageY, sourceLine, imgPath) {
    if (pendingForm) {
      pendingForm.remove();
      pendingForm = null;
    }

    const xPct = Math.round(imageX);
    const yPct = Math.round(imageY);

    const form = document.createElement("div");
    form.className = "comment-form";

    const quoted = document.createElement("div");
    quoted.className = "quoted-text";
    quoted.textContent = `Image: ${imgSrc} at (${xPct}%, ${yPct}%)`;

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
          selectedText: `Image: ${imgSrc} at (${xPct}%, ${yPct}%)`,
          sourceLine,
          startPath: imgPath,
          startOffset: 0,
          endPath: imgPath,
          endOffset: 0,
          imageX,
          imageY,
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
