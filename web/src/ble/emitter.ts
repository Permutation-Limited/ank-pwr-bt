// Minimal typed event emitter.

type Listener<T> = (payload: T) => void;

export class Emitter<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    (this.listeners[event] ??= new Set()).add(fn);
    return () => this.listeners[event]?.delete(fn);
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]) {
    this.listeners[event]?.forEach((fn) => {
      try { fn(payload); } catch (e) { console.error(e); }
    });
  }
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
