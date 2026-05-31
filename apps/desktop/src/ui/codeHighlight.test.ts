import { describe, expect, it } from "vitest";
import { codeLanguageLabel, highlightCode, languageForPath, languageFromClassName } from "./codeHighlight";

describe("codeHighlight", () => {
  it("extracts and labels fenced code languages", () => {
    expect(languageFromClassName("language-rs")).toBe("rust");
    expect(languageForPath("apps/desktop/src/ui/App.tsx")).toBe("tsx");
    expect(languageForPath("C:\\repo\\src\\main.rs")).toBe("rust");
    expect(codeLanguageLabel("ts")).toBe("TypeScript");
    expect(codeLanguageLabel(null)).toBe("Text");
  });

  it("highlights common Rust tokens", () => {
    const tokens = highlightCode("fn run() { let value = \"ok\"; }", "rust");

    expect(tokens).toEqual(expect.arrayContaining([
      { kind: "keyword", text: "fn" },
      { kind: "function", text: "run" },
      { kind: "keyword", text: "let" },
      { kind: "string", text: "\"ok\"" }
    ]));
  });

  it("falls back to plain text for unknown languages", () => {
    expect(highlightCode("hello", "unknown-lang")).toEqual([{ kind: "plain", text: "hello" }]);
  });
});
