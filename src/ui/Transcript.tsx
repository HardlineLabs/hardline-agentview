import {
  memo,
  createContext,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ChatItem, Turn } from "../shared/types";

type Props = {
  turns: Turn[];
  hasEarlier: boolean;
  scroll: RefObject<HTMLDivElement | null>;
  follow: RefObject<boolean>;
  Item: ComponentType<{ item: ChatItem; lazy?: boolean }>;
};
export const ToolState = createContext<Set<string> | null>(null);

// Keep ordinary short chats in document flow; virtualize individual items, since
// a single agent turn can contain thousands of messages and tool calls.
export const ConversationTranscript = memo(function ConversationTranscript(props: Props) {
  const count = props.turns.reduce((sum, turn) => sum + turn.items.length, 0);
  const [virtual, setVirtual] = useState(count > 80);
  const [expanded] = useState(() => new Set<string>());
  if (count > 80 && !virtual) setVirtual(true);
  const Item = props.Item;
  return (
    <ToolState.Provider value={expanded}>
      {virtual || count > 80 ? (
        <VirtualTranscript {...props} />
      ) : (
        <>
          {props.turns.map((turn) => (
            <div className="turn" key={turn.id}>
              {turn.items.map((item) => (
                <Item item={item} lazy key={item.id} />
              ))}
              {turn.error && (
                <div className="inline-error">{turn.error.message}</div>
              )}
            </div>
          ))}
        </>
      )}
    </ToolState.Provider>
  );
});

function VirtualTranscript({ turns, hasEarlier, scroll, follow, Item }: Props) {
  const rows = useMemo(
    () =>
      turns.flatMap((turn) => [
        ...turn.items.map((item, index) => ({
          key: `${turn.id}/${item.id}`,
          item,
          error: undefined as string | undefined,
          last: index === turn.items.length - 1 && !turn.error,
        })),
        ...(turn.error
          ? [
              {
                key: `${turn.id}/error`,
                item: undefined,
                error: turn.error.message,
                last: true,
              },
            ]
          : []),
      ]),
    [turns],
  );
  const list = useRef<HTMLDivElement>(null);
  const [insets, setInsets] = useState({ padding: 0, history: 0 });
  // Change the history-control inset in the same render as prepended rows.
  // A later scrollBy races the virtualizer's pending measurement/anchor work.
  const margin = insets.padding + (hasEarlier ? insets.history : 0);
  const getItemKey = useCallback((index: number) => rows[index].key, [rows]);
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scroll.current,
    getItemKey,
    estimateSize: (index) => {
      const item = rows[index].item;
      return item?.type === "agentMessage" ||
        item?.type === "userMessage" ||
        item?.type === "plan"
        ? 160
        : 44;
    },
    overscan: 6,
    scrollMargin: margin,
    anchorTo: "end",
    followOnAppend: "auto",
    scrollEndThreshold: 90,
  });
  useLayoutEffect(() => {
    const element = list.current,
      panel = scroll.current;
    if (!element || !panel) return;
    const measure = () => {
      const next =
        element.getBoundingClientRect().top -
        panel.getBoundingClientRect().top +
        panel.scrollTop;
      const control = panel.querySelector<HTMLElement>(".load-more");
      const style = control && getComputedStyle(control);
      const history =
        control && style
          ? control.getBoundingClientRect().height +
            parseFloat(style.marginTop) +
            parseFloat(style.marginBottom)
          : insets.history;
      const padding = next - (hasEarlier ? history : 0);
      if (
        Math.abs(padding - insets.padding) > 0.5 ||
        Math.abs(history - insets.history) > 0.5
      )
        setInsets({ padding, history });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    const control = panel.querySelector(".load-more");
    if (control) observer.observe(control);
    return () => observer.disconnect();
  }, [scroll, hasEarlier, insets]);
  useLayoutEffect(() => {
    if (follow.current) virtualizer.scrollToEnd();
  }, [virtualizer]);
  // Streaming changes the last item's height without appending an item. Follow
  // that growth only while the reader is at the bottom.
  useLayoutEffect(() => {
    const panel = scroll.current;
    if (follow.current && panel) panel.scrollTop = panel.scrollHeight;
  }, [turns, virtualizer.getTotalSize(), scroll, follow]);
  return (
    <div
      className="browser-transcript"
      ref={list}
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        overflowAnchor: "none",
      }}
    >
      {virtualizer.getVirtualItems().map((row) => {
        const data = rows[row.index];
        return (
          <div
            key={row.key}
            data-index={row.index}
            data-message-key={data.key}
            ref={virtualizer.measureElement}
            className="browser-message turn"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              margin: 0,
              display: "flow-root",
              paddingBottom: data.last ? 16 : 0,
              transform: `translateY(${row.start - margin}px)`,
            }}
          >
            {data.item ? (
              <Item item={data.item} lazy />
            ) : (
              <div className="inline-error">{data.error}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
