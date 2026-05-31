import { Button, Tooltip } from "tdesign-react";
import {
  CopyIcon,
  FullscreenIcon,
  ThumbDownFilledIcon,
  ThumbDownIcon,
  ThumbUpFilledIcon,
  ThumbUpIcon
} from "tdesign-icons-react";
import type { MessageFeedback } from "./composerTypes";

type MessageActionsProps = {
  feedback: MessageFeedback;
  onCopy: () => void;
  onDislike: () => void;
  onExpand: () => void;
  onLike: () => void;
};

export function MessageActions({ feedback, onCopy, onDislike, onExpand, onLike }: MessageActionsProps) {
  return (
    <div className="message-actions" aria-label="消息操作">
      <Tooltip content="复制">
        <Button aria-label="复制回复" icon={<CopyIcon size="16px" />} shape="square" type="button" variant="text" onClick={onCopy} />
      </Tooltip>
      <Tooltip content="有帮助">
        <Button
          aria-label="标记有帮助"
          className={feedback === "liked" ? "active" : ""}
          icon={feedback === "liked" ? <ThumbUpFilledIcon size="16px" /> : <ThumbUpIcon size="16px" />}
          shape="square"
          type="button"
          variant="text"
          onClick={onLike}
        />
      </Tooltip>
      <Tooltip content="没帮助">
        <Button
          aria-label="标记没帮助"
          className={feedback === "disliked" ? "active" : ""}
          icon={feedback === "disliked" ? <ThumbDownFilledIcon size="16px" /> : <ThumbDownIcon size="16px" />}
          shape="square"
          type="button"
          variant="text"
          onClick={onDislike}
        />
      </Tooltip>
      <Tooltip content="展开">
        <Button aria-label="展开回复" icon={<FullscreenIcon size="16px" />} shape="square" type="button" variant="text" onClick={onExpand} />
      </Tooltip>
    </div>
  );
}
