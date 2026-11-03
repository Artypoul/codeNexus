/**
 * 动态工具注册表。
 *
 * 工具通过 `dynamicToolRegistry.register(definition)` 声明式注册，
 * 注册后即可被注入 Codex 会话。真正执行由应用侧的动态工具处理器完成。
 *
 * 内置工具（如 image_generate）在模块加载时自动注册，外部工具可在运行时按需追加。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DynamicToolDefinition = {
  name: string;
  namespace?: string;
  label: string;
  description: string;
  requiresApproval: boolean;
  inputSchema: Record<string, unknown>;
  developerInstructions?: string;
};

export type DynamicToolSpecLike = {
  namespace?: string;
  name: string;
  description: string;
  inputSchema: unknown;
  deferLoading?: boolean;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class DynamicToolRegistry {
  private readonly tools = new Map<string, DynamicToolDefinition>();

  register(definition: DynamicToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  getDefinition(name: string): DynamicToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllNames(): string[] {
    return [...this.tools.keys()];
  }

  getAllDefinitions(): DynamicToolDefinition[] {
    return [...this.tools.values()];
  }

  isKnownToolName(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 根据用户启用/禁用状态，生成需要注入 Codex 会话的动态工具 spec 列表。
   */
  buildEnabledSpecs(
    enabledByName: Partial<Record<string, boolean>> | null | undefined,
  ): DynamicToolSpecLike[] {
    return this.getAllDefinitions()
      .filter((def) => enabledByName?.[def.name] !== false)
      .map((def) => ({
        namespace: def.namespace,
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        deferLoading: false,
      }));
  }

  buildSpecsForNames(names: readonly string[]): DynamicToolSpecLike[] {
    return names
      .map((name) => this.getDefinition(name))
      .filter((def): def is DynamicToolDefinition => def != null)
      .map((def) => ({
        namespace: def.namespace,
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        deferLoading: false,
      }));
  }

  /**
   * 构建默认的启用/禁用状态（所有已注册工具默认启用）。
   */
  buildDefaultEnabledByName(): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    for (const name of this.tools.keys()) {
      result[name] = true;
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Singleton registry instance
// ---------------------------------------------------------------------------

export const dynamicToolRegistry = new DynamicToolRegistry();

// ---------------------------------------------------------------------------
// Built-in: image_generate
// ---------------------------------------------------------------------------

export const IMAGE_GENERATION_DYNAMIC_TOOL_NAMESPACE = "codenexus";
export const IMAGE_GENERATION_DYNAMIC_TOOL_NAME = "image_generate";

export const IMAGE_GENERATION_DYNAMIC_TOOL_DEVELOPER_INSTRUCTIONS = [
  "For every user request to create, draw, render, or generate an image, call the codenexus.image_generate dynamic tool.",
  "If the user's current message includes image attachments, codenexus.image_generate automatically uses those attachments as reference images for image editing.",
  "Do not call image_gen, image_generation, or any official built-in image generation tool.",
  "If codenexus.image_generate is unavailable, explain that image generation is unavailable instead of using another image tool.",
].join("\n");

dynamicToolRegistry.register({
  namespace: IMAGE_GENERATION_DYNAMIC_TOOL_NAMESPACE,
  name: IMAGE_GENERATION_DYNAMIC_TOOL_NAME,
  label: "Generate image",
  description: `${IMAGE_GENERATION_DYNAMIC_TOOL_DEVELOPER_INSTRUCTIONS} Rewrite the user's request into a complete visual prompt before calling. When image attachments are present in the current user message, they are supplied automatically as reference images; do not include image bytes or paths in the tool arguments.`,
  requiresApproval: false,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      prompt: {
        type: "string",
        minLength: 1,
        description:
          "A complete image prompt describing subject, composition, style, colors, text, and any constraints requested by the user.",
      },
      size: {
        type: "string",
        description:
          "Optional output size, for example 1024x1024, 1024x1536, 1536x1024, or auto.",
      },
      quality: {
        type: "string",
        description:
          "Optional quality hint such as auto, low, medium, or high.",
      },
      output_format: {
        type: "string",
        description: "Optional output format such as png, jpeg, or webp.",
      },
      n: {
        type: "integer",
        minimum: 1,
        maximum: 4,
        description: "Number of images to generate.",
      },
    },
    required: ["prompt"],
  },
  developerInstructions: IMAGE_GENERATION_DYNAMIC_TOOL_DEVELOPER_INSTRUCTIONS,
});
