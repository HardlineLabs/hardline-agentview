import type { ChatPage } from "../shared/types";

// A count alone does not bound memory: one turn can contain a large transcript.
// This is an estimated retained-content budget, not a JavaScript heap guarantee.
export class RecentConversations {
  private pages = new Map<string, { page: ChatPage; size: number }>();
  private sizes = new WeakMap<object, number>();
  constructor(
    private budget = 4 * 1024 * 1024,
    private limit = 5,
  ) {}
  get(id: string) {
    return this.pages.get(id)?.page;
  }
  delete(id: string) {
    this.pages.delete(id);
  }
  clear() {
    this.pages.clear();
  }
  set(id: string, page: ChatPage) {
    this.pages.delete(id);
    const size = this.size(page);
    if (size > this.budget) return;
    this.pages.set(id, { page, size });
    let total = [...this.pages.values()].reduce(
      (sum, entry) => sum + entry.size,
      0,
    );
    for (const [key, entry] of this.pages) {
      if (total <= this.budget && this.pages.size <= this.limit) break;
      this.pages.delete(key);
      total -= entry.size;
    }
  }
  private size(value: unknown): number {
    if (typeof value === "string") return value.length * 2;
    if (!value || typeof value !== "object") return 8;
    const cached = this.sizes.get(value);
    if (cached !== undefined) return cached;
    let size = 32;
    for (const [key, child] of Object.entries(value)) {
      size += key.length * 2 + this.size(child);
      if (size > this.budget) break;
    }
    this.sizes.set(value, size);
    return size;
  }
}
