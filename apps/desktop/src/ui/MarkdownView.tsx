import { useState, isValidElement, type HTMLAttributes, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyIcon } from "tdesign-icons-react";
import { codeLanguageLabel, highlightCode, languageFromClassName } from "./codeHighlight";

const markdownComponents: Components = {
  pre({ children, ...props }) {
    return <CopyableCodeBlock props={props}>{children}</CopyableCodeBlock>;
  }
};

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown-view">
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

function CopyableCodeBlock({
  children,
  props
}: {
  children: ReactNode;
  props: HTMLAttributes<HTMLPreElement>;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const codeText = textFromNode(children).replace(/\n$/, "");
  const language = languageFromClassName(codeClassName(children));
  const highlighted = highlightCode(codeText, language);

  async function copyCode() {
    if (!codeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(codeText);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1200);
    }
  }

  return (
    <div className="markdown-code-block">
      <span className="markdown-code-language">{codeLanguageLabel(language)}</span>
      <button
        aria-label={copyState === "copied" ? "代码已复制" : copyState === "failed" ? "复制代码失败" : "复制代码"}
        className={`markdown-code-copy ${copyState}`}
        type="button"
        onClick={() => void copyCode()}
      >
        <CopyIcon size="13px" />
        <span>{copyState === "copied" ? "已复制" : copyState === "failed" ? "失败" : "复制"}</span>
      </button>
      <pre {...props}>
        <code className={language ? `language-${language}` : undefined}>
          {highlighted.map((token, index) => (
            <span className={token.kind === "plain" ? undefined : `code-token ${token.kind}`} key={`${index}-${token.kind}`}>
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function codeClassName(node: ReactNode): unknown {
  if (Array.isArray(node)) {
    return node.map(codeClassName).find(Boolean);
  }
  if (isValidElement<{ className?: unknown; children?: ReactNode }>(node)) {
    return node.props.className ?? codeClassName(node.props.children);
  }
  return null;
}

function textFromNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textFromNode).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return textFromNode(node.props.children);
  }
  return "";
}
