import { describe, expect, it } from "bun:test";
import { normalizeToolName } from "./toolNames";

describe("normalizeToolName", () => {
  it("maps canonical clpzcode names to the TUI snake tokens", () => {
    expect(normalizeToolName("Zsh")).toBe("bash");
    expect(normalizeToolName("Bash")).toBe("bash");
    expect(normalizeToolName("Read")).toBe("read_file");
    expect(normalizeToolName("Write")).toBe("write_file");
    expect(normalizeToolName("Edit")).toBe("edit_file");
    expect(normalizeToolName("MultiEdit")).toBe("edit_file");
    expect(normalizeToolName("WebSearch")).toBe("search_web");
  });

  it("passes through names the UI already understands or doesn't map", () => {
    expect(normalizeToolName("read_file")).toBe("read_file");
    expect(normalizeToolName("Glob")).toBe("Glob");
    expect(normalizeToolName("Grep")).toBe("Grep");
    expect(normalizeToolName("Agent")).toBe("Agent");
  });

  it("returns empty string for missing names", () => {
    expect(normalizeToolName(undefined)).toBe("");
    expect(normalizeToolName(null)).toBe("");
    expect(normalizeToolName("")).toBe("");
  });
});
