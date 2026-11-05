import { describe, expect, it } from "vitest";
import {
  findProjectForWorkspace,
  normalizeProjectPath,
  projectAutoCreateKey,
  projectNameFromWorkspace,
} from "./projectWorkspaceMatch";

function project(id: string, roots: string[], position = 0) {
  return {
    id,
    name: id,
    roots: roots.map((path) => ({ path })),
    position,
  };
}

describe("project workspace matching", () => {
  it("normalizes separators, case, trailing slashes, and Windows extended paths", () => {
    expect(normalizeProjectPath("\\\\?\\D:\\Projects\\Jingcai-Web\\")).toBe("d:\\projects\\jingcai-web");
    expect(normalizeProjectPath("D:/projects/jingcai-web")).toBe("d:\\projects\\jingcai-web");
  });

  it("matches a workspace inside a project root and prefers the longest root", () => {
    const projects = [project("broad", ["D:\\projects"]), project("specific", ["D:\\projects\\jingcai-web"])];
    expect(findProjectForWorkspace(projects, "D:\\projects\\jingcai-web\\data")?.id).toBe("specific");
    expect(findProjectForWorkspace(projects, "D:\\projects\\other")?.id).toBe("broad");
    expect(findProjectForWorkspace(projects, "D:\\elsewhere")).toBeNull();
  });

  it("does not match a sibling with the same prefix", () => {
    const projects = [project("p1", ["D:\\projects\\jingcai-web"])];
    expect(findProjectForWorkspace(projects, "D:\\projects\\jingcai-web-2")).toBeNull();
  });

  it("builds a stable project name and idempotency key", () => {
    expect(projectNameFromWorkspace("D:\\projects\\jingcai-web\\")).toBe("jingcai-web");
    expect(projectAutoCreateKey("D:\\projects\\jingcai-web")).toBe(projectAutoCreateKey("d:/projects/JINGCAI-WEB/"));
  });
});
