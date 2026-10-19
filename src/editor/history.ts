export type HistoryEntry = { undo: () => void; redo: () => void };

const HISTORY_LIMIT = 200;

export function createHistory(limit = HISTORY_LIMIT) {
  const done: HistoryEntry[] = [];
  const undone: HistoryEntry[] = [];
  return {
    push(entry: HistoryEntry) {
      done.push(entry);
      if (done.length > limit) done.shift();
      undone.length = 0;
    },
    undo(): boolean {
      const entry = done.pop();
      if (!entry) return false;
      entry.undo();
      undone.push(entry);
      return true;
    },
    redo(): boolean {
      const entry = undone.pop();
      if (!entry) return false;
      entry.redo();
      done.push(entry);
      return true;
    },
    clear() {
      done.length = 0;
      undone.length = 0;
    },
  };
}
