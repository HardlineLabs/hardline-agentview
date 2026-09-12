import type { AccountLimits, TokenUsage } from "../shared/types";

const number = (value: number) => value.toLocaleString();
export function ContextUsage({
  usage,
  compact = false,
}: {
  usage?: TokenUsage;
  compact?: boolean;
}) {
  const capacity = usage?.modelContextWindow;
  const used = usage?.last.totalTokens;
  const percent =
    capacity && used != null
      ? Math.min(100, Math.max(0, (used / capacity) * 100))
      : null;
  if (compact)
    return (
      <details className="context-compact">
        <summary aria-label="Context details">
          <span>Context</span>
          <meter
            min={0}
            max={100}
            value={percent ?? 0}
            aria-label="Context window used"
          />
          <span>{percent == null ? "--" : `${Math.round(percent)}%`}</span>
        </summary>
        <div>
          <p>
            {used == null
              ? "Usage appears when Codex reports it."
              : `${number(used)} / ${capacity ? number(capacity) : "unknown limit"} tokens / ${number(usage!.total.totalTokens)} total`}
          </p>
          <p>
            Latest request, including its response. Codex may compact history
            automatically.
          </p>
          {percent != null && percent >= 80 && (
            <p className="usage-high">
              Context is filling up. A fresh agent may help keep the next task
              focused.
            </p>
          )}
        </div>
      </details>
    );
  return (
    <div
      className="context-usage"
      title="Context is the latest model request, including its response. Conversation total is cumulative and can exceed the context window. Codex may compact history automatically."
    >
      <div>
        <span>Context</span>
        <strong>
          {percent == null
            ? "Not reported yet"
            : `${Math.round(percent)}% used`}
        </strong>
      </div>
      {percent != null && (
        <meter
          min={0}
          max={100}
          value={percent}
          aria-label="Context window used"
        />
      )}
      <small>
        {used == null
          ? "Usage appears when Codex reports it."
          : `${number(used)} / ${capacity ? number(capacity) : "unknown limit"} tokens · ${number(usage!.total.totalTokens)} total`}
      </small>
      {percent != null && percent >= 80 && (
        <small className="usage-high">
          Context is filling up. A fresh agent may help keep the next task
          focused.
        </small>
      )}
    </div>
  );
}

export function UsageLimits({
  limits,
  connected,
}: {
  limits?: AccountLimits;
  connected: boolean;
}) {
  const primary =
    limits?.buckets.find((b) => b.limitId === "codex")?.primary ||
    limits?.buckets[0]?.primary;
  return (
    <details className="usage-limits">
      <summary>
        Codex limits{" "}
        <span>
          {!connected
            ? "Offline"
            : limits?.error
              ? "Unavailable"
              : primary
                ? `${Math.round(primary.usedPercent)}% used`
                : "Not reported"}
        </span>
      </summary>
      {limits?.buckets
        .slice()
        .sort(
          (a, b) =>
            Number(b.limitId === "codex") - Number(a.limitId === "codex"),
        )
        .map((bucket, index) => (
          <div className="limit-bucket" key={bucket.limitId || index}>
            <strong>{bucket.limitName || bucket.limitId || "Codex"}</strong>
            {(["primary", "secondary"] as const).map((key) => {
              const window = bucket[key];
              if (!window) return null;
              const minutes = window.windowDurationMins;
              const duration = minutes
                ? minutes >= 1440
                  ? `${minutes / 1440} day`
                  : minutes >= 60
                    ? `${minutes / 60} hour`
                    : `${minutes} minute`
                : key;
              return (
                <div className="limit-window" key={key}>
                  <div>
                    <span>{duration} window</span>
                    <span>{Math.round(window.usedPercent)}% used</span>
                  </div>
                  <meter
                    min={0}
                    max={100}
                    value={window.usedPercent}
                    aria-label={`${duration} usage limit`}
                  />
                  <small>
                    {window.resetsAt
                      ? `Resets ${new Date(window.resetsAt * 1000).toLocaleString()}`
                      : "Reset time not reported"}
                  </small>
                </div>
              );
            })}
            {!bucket.primary && !bucket.secondary && (
              <small>No quota windows reported.</small>
            )}
            {bucket.credits?.hasCredits && (
              <small>
                {bucket.credits.unlimited
                  ? "Unlimited credits"
                  : `Credits: ${bucket.credits.balance ?? "balance not reported"}`}
              </small>
            )}
          </div>
        ))}
      {(!limits?.buckets.length || limits?.error) && (
        <small>
          {limits?.error || "Waiting for Codex to report account limits."}
        </small>
      )}
      {!!limits?.checkedAt && (
        <small>
          Updated {new Date(limits.checkedAt).toLocaleTimeString()}
          {!connected ? " · Last received values" : ""}
        </small>
      )}
    </details>
  );
}
