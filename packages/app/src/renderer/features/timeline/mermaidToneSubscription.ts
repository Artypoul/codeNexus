// 共享 Mermaid 主题订阅：所有 Markdown 卡片复用同一个 document 级观察器，
// 避免每一条消息都挂一个 MutationObserver 监听 data-tone。
import { readMermaidTone, type MermaidTone } from "./mermaidRenderer";

type ToneListener = (tone: MermaidTone) => void;

const listeners = new Set<ToneListener>();
let sharedObserver: MutationObserver | null = null;

export function subscribeMermaidTone(listener: ToneListener): () => void {
  listeners.add(listener);
  if (!sharedObserver && typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
    sharedObserver = new MutationObserver(() => {
      const nextTone = readMermaidTone();
      for (const current of listeners) current(nextTone);
    });
    sharedObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-tone"],
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    sharedObserver?.disconnect();
    sharedObserver = null;
  };
}
