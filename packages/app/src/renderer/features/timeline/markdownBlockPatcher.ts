type MarkdownBlock = {
  source: string;
  nodes: ChildNode[];
};

/** Compare unenhanced HTML, retaining live DOM (highlighting, selection and SVGs)
 * for unchanged blocks. Only the changed middle is detached and enhanced again.
 * The template must contain HTML already sanitized by markdownRenderer.
 */
export function createMarkdownBlockPatcher() {
  let blocks: MarkdownBlock[] | null = null;

  return {
    reset() {
      blocks = null;
    },
    // Mermaid enhancement can replace a top-level <pre> asynchronously.
    // Keep that block associated with its live replacement nodes.
    trackReplacement(previous: ChildNode, replacements: ChildNode[]) {
      for (const block of blocks ?? []) {
        const index = block.nodes.indexOf(previous);
        if (index < 0) continue;
        block.nodes.splice(index, 1, ...replacements);
        return;
      }
    },
    patch(host: HTMLElement, template: HTMLElement, prepareBlock: (stage: HTMLElement) => void) {
      const incoming = Array.from(template.childNodes).map((node) => ({
        source: node instanceof Element ? node.outerHTML : `${node.nodeType}:${node.textContent ?? ""}`,
        node,
      }));
      // Also recover safely if a consumer replaced top-level nodes externally.
      if (!blocks || blocks.some((block) => block.nodes.some((node) => node.parentNode !== host))) {
        host.replaceChildren();
        blocks = [];
      }
      let start = 0;
      while (start < blocks.length && start < incoming.length && blocks[start].source === incoming[start].source) {
        start += 1;
      }
      if (start === blocks.length && start === incoming.length) return;
      let oldEnd = blocks.length;
      let newEnd = incoming.length;
      while (oldEnd > start && newEnd > start && blocks[oldEnd - 1].source === incoming[newEnd - 1].source) {
        oldEnd -= 1;
        newEnd -= 1;
      }
      for (let index = start; index < oldEnd; index += 1) {
        for (const node of blocks[index].nodes) node.remove();
      }
      const fragment = document.createDocumentFragment();
      const changed: MarkdownBlock[] = [];
      for (let index = start; index < newEnd; index += 1) {
        const { source, node } = incoming[index];
        const stage = document.createElement("div");
        stage.append(node);
        prepareBlock(stage);
        const nodes = Array.from(stage.childNodes);
        fragment.append(...nodes);
        changed.push({ source, nodes });
      }
      host.insertBefore(fragment, blocks[oldEnd]?.nodes[0] ?? null);
      blocks = [...blocks.slice(0, start), ...changed, ...blocks.slice(oldEnd)];
    },
  };
}
