import { describe, expect, it } from "vitest";
import { isPathLikeStrong, isPathLikeStrict, parsePathToken, tokenizePathLikeText } from "./pathHighlight";

describe("path highlighting", () => {
  it("does not highlight slash-separated CJK prose", () => {
    const text = "有序/无序/嵌套列表、引用、分隔线、围栏代码块、缩进代码块、表格。";

    expect(tokenizePathLikeText(text)).toEqual([{ kind: "text", value: text }]);
    expect(isPathLikeStrong(text)).toBe(false);
    expect(isPathLikeStrict(text)).toBe(false);
  });

  it("does not treat ASCII alternatives or word lists as paths", () => {
    for (const text of ["A/B/C", "input/output/error", "Node.js/TypeScript/Vue", "2024/01/02", "metrics/2024.11"]) {
      expect(tokenizePathLikeText(text)).toEqual([{ kind: "text", value: text }]);
      expect(isPathLikeStrong(text)).toBe(false);
    }
  });

  it("highlights explicit repository, absolute and relative paths", () => {
    expect(tokenizePathLikeText("修改 packages/app/src/App.vue:12")).toContainEqual({
      kind: "path",
      value: "packages/app/src/App.vue:12",
    });
    expect(tokenizePathLikeText("打开 D:/Desktop/codeNexus/README.md")).toContainEqual({
      kind: "path",
      value: "D:/Desktop/codeNexus/README.md",
    });
    expect(tokenizePathLikeText("查看 /usr/local/bin")).toContainEqual({
      kind: "path",
      value: "/usr/local/bin",
    });
    expect(tokenizePathLikeText("查看 ./src/App.vue")).toContainEqual({
      kind: "path",
      value: "./src/App.vue",
    });
  });

  it("extracts a path that is glued to surrounding CJK prose", () => {
    expect(tokenizePathLikeText("修改src/foo.ts然后")).toEqual([
      { kind: "text", value: "修改" },
      { kind: "path", value: "src/foo.ts" },
      { kind: "text", value: "然后" },
    ]);
    expect(tokenizePathLikeText("src/foo.ts:12然后")).toEqual([
      { kind: "path", value: "src/foo.ts:12" },
      { kind: "text", value: "然后" },
    ]);
    expect(tokenizePathLikeText("src/foo.ts…")).toEqual([
      { kind: "path", value: "src/foo.ts" },
      { kind: "text", value: "…" },
    ]);
  });

  it("supports known prefixes, extensions and CJK path segments", () => {
    expect(tokenizePathLikeText("docs/guide/intro")).toContainEqual({
      kind: "path",
      value: "docs/guide/intro",
    });
    expect(tokenizePathLikeText("src/组件/按钮.vue")).toContainEqual({
      kind: "path",
      value: "src/组件/按钮.vue",
    });
    expect(tokenizePathLikeText("foo/bar.py")).toContainEqual({
      kind: "path",
      value: "foo/bar.py",
    });
  });

  it("keeps ambiguous bare folder sequences in prose untouched", () => {
    const text = "foo/bar/baz";

    expect(tokenizePathLikeText(text)).toEqual([{ kind: "text", value: text }]);
    expect(isPathLikeStrong(text)).toBe(false);
    expect(isPathLikeStrict(text)).toBe(true);
  });

  it("keeps URLs as plain text", () => {
    const text = "https://example.com/a/b";

    expect(tokenizePathLikeText(text)).toEqual([{ kind: "text", value: text }]);
    expect(isPathLikeStrict(text)).toBe(false);
  });

  it("does not treat commands containing a path as a single path", () => {
    expect(isPathLikeStrict("cat src/foo.ts")).toBe(false);
    expect(isPathLikeStrict("src/foo.ts --watch")).toBe(false);
  });

  it("returns the extracted path rather than surrounding prose", () => {
    expect(parsePathToken("修改src/foo.ts然后")).toEqual(
      expect.objectContaining({
        full: "src/foo.ts",
        core: "src/foo.ts",
        basename: "foo.ts",
      })
    );
  });
});
