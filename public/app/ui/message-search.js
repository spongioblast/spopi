// ABOUTME: Highlights a search query inside rendered message content and removes those highlights again.
// ABOUTME: Only text inside .message-content is searched; marks carry data-search-highlight="true".

/**
 * @param {string} text
 */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * @param {Text} node
 * @param {RegExp} pattern
 * @param {(mark: HTMLElement) => void} [onMatch]
 */
function highlightTextNode(node, pattern, onMatch) {
  const text = node.textContent || "";
  const regex = new RegExp(pattern.source, pattern.flags);
  let lastIndex = 0;
  let matchCount = 0;
  let match = regex.exec(text);
  if (!match) return 0;

  const fragment = document.createDocumentFragment();
  while (match) {
    const [matchedText] = match;
    const start = match.index;
    if (start > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));
    }

    const mark = document.createElement("mark");
    mark.dataset.searchHighlight = "true";
    mark.textContent = matchedText;
    fragment.appendChild(mark);
    if (typeof onMatch === "function") onMatch(mark);

    matchCount += 1;
    lastIndex = start + matchedText.length;
    match = regex.exec(text);
  }

  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }

  node.replaceWith(fragment);
  return matchCount;
}

/**
 * @param {HTMLElement} container
 */
export function clearSearchHighlights(container) {
  const marks = container.querySelectorAll("mark[data-search-highlight='true']");
  marks.forEach((mark) => {
    const text = document.createTextNode(mark.textContent || "");
    mark.replaceWith(text);
    text.parentNode?.normalize();
  });
}

/**
 * @param {HTMLElement} container
 * @param {string} query already trimmed and non-empty
 * @param {boolean} scrollToFirst
 * @returns {number} match count
 */
export function highlightSearchMatches(container, query, scrollToFirst) {
  const pattern = new RegExp(escapeRegExp(query), "gi");
  let matchCount = 0;
  /** @type {HTMLElement[]} */
  const matches = [];

  container.querySelectorAll(".message-content").forEach((content) => {
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (!node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
        if (node.parentElement?.closest("mark[data-search-highlight='true']")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    /** @type {Text[]} */
    const textNodes = [];
    let currentNode = walker.nextNode();
    while (currentNode) {
      if (currentNode instanceof Text) textNodes.push(currentNode);
      currentNode = walker.nextNode();
    }

    textNodes.forEach((node) => {
      const count = highlightTextNode(node, pattern, (mark) => {
        if (matches.length === 0) matches.push(mark);
      });
      matchCount += count;
    });
  });

  const firstMatch = matches[0];
  if (scrollToFirst && firstMatch && typeof firstMatch.scrollIntoView === "function") {
    firstMatch.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  return matchCount;
}
