import { useState } from "react";

export type ReasoningBlock = { id: string; text: string };

export function ReasoningPanel({ block }: { block: ReasoningBlock }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="reasoning-panel transcript-event">
      <button className="event-row-button" type="button" onClick={() => setExpanded((current) => !current)}>
        <span className="event-row-title">
            <span className="event-dot" aria-hidden="true" />
            思考过程
        </span>
        <span className="event-row-meta">{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded ? (
        <div className="reasoning-body">
          <p>{block.text}</p>
        </div>
      ) : null}
    </section>
  );
}
