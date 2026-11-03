import type { UiLanguage } from "@codenexus/shared/localSettings";

type AttributeSnapshot = Record<string, string>;

const textOriginalByNode = new WeakMap<Text, string>();
const attrOriginalByElement = new WeakMap<Element, AttributeSnapshot>();

const TRANSLATIONS: Record<string, string> = {
  调整文件编辑器宽度: "Resize file editor",
  从左侧边缘拉出导航面板: "Drag from the left edge to show the navigation panel",
  调整左侧导航面板宽度: "Resize left navigation panel",
  主视图: "Main view",
  聊天: "Chat",
  图片: "Images",
  面板: "Panels",
  打开设置: "Open settings",
  设置页中暂不显示线程面板: "The thread panel is hidden on the settings page",
  关闭线程面板: "Hide thread panel",
  打开线程面板: "Show thread panel",
  先选择工作区后再打开文件面板: "Select a workspace before opening the files panel",
  设置页中暂不显示文件面板: "The files panel is hidden on the settings page",
  图片视图中暂不显示文件面板: "The files panel is hidden in image view",
  关闭文件面板: "Hide files panel",
  打开文件面板: "Show files panel",
  设置页: "Settings",
  设置导航: "Settings navigation",
  设置选项卡: "Settings tabs",
  基础配置: "Basics",
  通用: "General",
  全局配置与界面偏好: "Global configuration and interface preferences",
  能力扩展: "Extensions",
  集成与工具: "Integrations and tools",
  "Skills、MCP 与扩展能力": "Skills, MCP, and extension capabilities",
  图片生成: "Image generation",
  "OpenAI Images API 与本地工作台": "OpenAI Images API and local workbench",
  运行状态: "Runtime",
  提示音: "Notification sound",
  线程结束提醒与音量: "Thread completion alerts and volume",
  环境检测: "Environment checks",
  本机依赖与运行环境: "Local dependencies and runtime",
  全局配置: "Global configuration",
  重置: "Reset",
  刷新: "Refresh",
  关闭: "Close",
  字体与字号: "Font and size",
  "切换全局字体样式与整体字号缩放，立即生效。": "Change the global font and overall size immediately.",
  字体: "Font",
  字号: "Size",
  语言: "Language",
  "选择界面显示语言，切换后立即生效。": "Choose the interface language. Changes apply immediately.",
  "AI 最终答复格式": "AI final answer format",
  "仅在执行（agent/default）模式生效；计划（plan）模式保持原有输出。":
    "Only applies in execution mode (agent/default); plan mode keeps its original output.",
  "AI 计划输出格式": "AI plan output format",
  "仅影响计划（plan）模式的计划输出（item/plan/delta）。": "Only affects plan-mode plan output (item/plan/delta).",
  格式: "Format",
  模型: "Model",
  服务层级: "Service tier",
  标准: "Standard",
  快速: "Fast",
  自定义模型: "Custom models",
  可用模型: "Available models",
  添加: "Add",
  删除: "Delete",
  上下文预设: "Context preset",
  窗口上限: "Window limit",
  压缩阈值: "Compaction threshold",
  推理强度: "Reasoning effort",
  思考摘要: "Reasoning summary",
  审批策略: "Approval policy",
  "granular（细粒度）": "granular",
  沙箱审批: "Sandbox approval",
  规则审批: "Rules approval",
  技能审批: "Skill approval",
  权限请求: "Permission requests",
  "MCP 输入请求": "MCP elicitations",
  审批复核方: "Approval reviewer",
  沙箱模式: "Sandbox mode",
  提权沙箱: "Elevated sandbox",
  启用后使用提权沙箱: "Use elevated sandbox when enabled",
  统一执行: "Unified execution",
  启用统一执行流程: "Use the unified execution flow",
  "流式文件 Diff": "Streaming file diff",
  "启用 patchUpdated 文件变更流": "Enable patchUpdated file change stream",
  保存: "Save",
  检测: "Check",
  检测结果: "Check results",
  "处理中…": "Processing...",
  手动安装指引: "Manual installation guide",
  提示: "Tip",
  "调试日志请打开开发者工具（DevTools）控制台查看。": "Open DevTools to view debug logs.",
  计划问答: "Plan Q&A",
  当前无待回答问题: "No pending questions",
  "请在浏览器中完成外部确认，然后回到这里继续。":
    "Complete the external confirmation in your browser, then return here.",
  取消: "Cancel",
  打开链接: "Open link",
  上一步: "Back",
  提交: "Submit",
  下一步: "Next",
  链接确认: "Link confirmation",
  "JSON 输入": "JSON input",
  请输入其他内容: "Enter other content",
  请输入答案: "Enter an answer",
  已完成: "Completed",
  "提交 JSON": "Submit JSON",
  生成图片: "Generate image",
  查看图片: "View image",
  生成细节: "Generation details",
  修订提示词: "Revised prompt",
  读取中: "Reading",
  生成中: "Generating",
  已读取: "Read",
  已生成: "Generated",
  读取失败: "Read failed",
  生成失败: "Generation failed",
  状态未知: "Unknown status",
  思考: "Reasoning",
  原始推理: "Raw reasoning",
  执行计划: "Execute plan",
  "执行中...": "Executing...",
  本轮用量: "Turn usage",
  输入: "Input",
  缓存输入: "Cached input",
  输出: "Output",
  推理输出: "Reasoning output",
  本轮总计: "Turn total",
  累计总计: "Cumulative total",
  上下文窗口: "Context window",
  关闭提示: "Close notification",
  确认: "Confirm",
  下拉选择: "Select",
  纯文本: "Plain text",
  未连接服务: "Service not connected",
  任务完成: "Task completed",
  无工作区: "No workspace",
  未命名线程: "Untitled thread",
  已完成上下文压缩: "Context compaction completed",
  "正在压缩上下文…": "Compacting context...",
  "请求已提交，等待模型调度。": "Request submitted. Waiting for model scheduling.",
  "模型正在准备回复。": "The model is preparing a response.",
  "模型正在分析上下文。": "The model is analyzing context.",
  "模型正在输出内容。": "The model is streaming content.",
  "等待继续输出。": "Waiting for more output.",
  "本回合已完成。": "This turn is complete.",
  "本回合执行失败。": "This turn failed.",
};

const SKIP_SELECTOR = [
  "script",
  "style",
  "textarea",
  "input",
  "pre",
  "code",
  "[contenteditable='true']",
  "[data-i18n-skip]",
  ".agent-markdown-content",
  ".markdown-body",
  ".cm-editor",
].join(",");

const ATTRIBUTE_SKIP_SELECTOR = [
  "script",
  "style",
  "pre",
  "code",
  "[contenteditable='true']",
  "[data-i18n-skip]",
  ".agent-markdown-content",
  ".markdown-body",
  ".cm-editor",
].join(",");

const TRANSLATABLE_ATTRIBUTES = ["aria-label", "title", "placeholder"];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function translatePattern(value: string): string {
  const normalized = normalizeText(value);
  const exact = TRANSLATIONS[normalized];
  if (exact) return exact;

  let match = normalized.match(/^已修改\s+(\d+)\s+项$/u);
  if (match) return `${match[1]} changed`;
  match = normalized.match(/^待输入\s+(\d+)$/u);
  if (match) return `${match[1]} pending`;
  match = normalized.match(/^(\d+)\s+段$/u);
  if (match) return `${match[1]} parts`;
  match = normalized.match(/^(\d+)\s+个 SSH 调用$/u);
  if (match) return `${match[1]} SSH calls`;
  match = normalized.match(/^缓存\s+(.+)$/u);
  if (match) return `Cached ${match[1]}`;
  match = normalized.match(/^上下文\s+(.+)$/u);
  if (match) return `Context ${match[1]}`;
  match = normalized.match(/^附图\s+(\d+)\s+张$/u);
  if (match) return `${match[1]} images attached`;
  match = normalized.match(/^\+(\d+)\s+文件$/u);
  if (match) return `+${match[1]} files`;
  match = normalized.match(/^\+(\d+)\s+图片$/u);
  if (match) return `+${match[1]} images`;
  match = normalized.match(/^返回\s+(\d+)\s+张图片$/u);
  if (match) return `${match[1]} images returned`;
  match = normalized.match(/^图片生成\s+·\s+(\d+)\s+张结果$/u);
  if (match) return `Image generation · ${match[1]} results`;
  match = normalized.match(/^检测失败：(.+)$/u);
  if (match) return `Check failed: ${match[1]}`;
  match = normalized.match(/^加载失败：(.+)$/u);
  if (match) return `Load failed: ${match[1]}`;
  match = normalized.match(/^保存失败：(.+)$/u);
  if (match) return `Save failed: ${match[1]}`;
  match = normalized.match(/^正在搜索\s+(.+)$/u);
  if (match) return `Searching ${match[1]}`;
  match = normalized.match(/^已搜索\s+(.+)$/u);
  if (match) return `Searched ${match[1]}`;
  match = normalized.match(/^正在打开\s+(.+)$/u);
  if (match) return `Opening ${match[1]}`;
  match = normalized.match(/^已打开\s+(.+)$/u);
  if (match) return `Opened ${match[1]}`;
  match = normalized.match(/^正在处理\s+(.+)$/u);
  if (match) return `Processing ${match[1]}`;
  match = normalized.match(/^已处理\s+(.+)$/u);
  if (match) return `Processed ${match[1]}`;

  return normalized;
}

function translatePreservingOuterWhitespace(value: string): string {
  if (!/[\u4e00-\u9fff]/u.test(value)) return value;
  const leading = value.match(/^\s*/u)?.[0] ?? "";
  const trailing = value.match(/\s*$/u)?.[0] ?? "";
  const translated = translatePattern(value);
  return `${leading}${translated}${trailing}`;
}

function shouldSkipNode(node: Node): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest(SKIP_SELECTOR));
}

function translateTextNode(node: Text, language: UiLanguage): void {
  if (shouldSkipNode(node)) return;
  const current = node.nodeValue ?? "";
  let original = textOriginalByNode.get(node) ?? current;
  if (!textOriginalByNode.has(node) || /[\u4e00-\u9fff]/u.test(current)) {
    original = current;
    textOriginalByNode.set(node, original);
  }
  const next = language === "en-US" ? translatePreservingOuterWhitespace(original) : original;
  if (node.nodeValue !== next) node.nodeValue = next;
}

function translateAttributes(element: Element, language: UiLanguage): void {
  if (element.closest(ATTRIBUTE_SKIP_SELECTOR)) return;
  let snapshot = attrOriginalByElement.get(element);
  if (!snapshot) {
    snapshot = {};
    attrOriginalByElement.set(element, snapshot);
  }
  for (const attr of TRANSLATABLE_ATTRIBUTES) {
    const current = element.getAttribute(attr);
    if (current == null) continue;
    if (!(attr in snapshot) || /[\u4e00-\u9fff]/u.test(current)) snapshot[attr] = current;
    const original = snapshot[attr] ?? current;
    const next = language === "en-US" ? translatePreservingOuterWhitespace(original) : original;
    if (current !== next) element.setAttribute(attr, next);
  }
}

function walk(root: ParentNode, language: UiLanguage): void {
  if (root instanceof Element) translateAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text, language);
    else if (current instanceof Element) translateAttributes(current, language);
    current = walker.nextNode();
  }
}

export function installDomI18nFallback(getLanguage: () => UiLanguage): () => void {
  let scheduled = false;
  const apply = () => {
    scheduled = false;
    walk(document.body, getLanguage());
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(apply);
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRIBUTES,
  });
  schedule();

  return () => observer.disconnect();
}

export function refreshDomI18nFallback(language: UiLanguage): void {
  walk(document.body, language);
}
