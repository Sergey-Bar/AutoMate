import { useEffect, useSyncExternalStore } from 'react';
import type { CommandAction } from '@automate/ui';

class CommandStore {
  private actions: Map<string, CommandAction> = new Map();
  private listeners: Set<() => void> = new Set();
  private cachedActions: CommandAction[] = [];

  register(actions: CommandAction[]) {
    let changed = false;
    actions.forEach(action => {
      const existing = this.actions.get(action.id);
      if (existing !== action) {
        this.actions.set(action.id, action);
        changed = true;
      }
    });

    // limit to 50
    if (this.actions.size > 50) {
      const keys = Array.from(this.actions.keys()).slice(-50); // Keep last 50
      const newMap = new Map();
      keys.forEach(k => newMap.set(k, this.actions.get(k)!));
      this.actions = newMap;
      changed = true;
    }

    if (changed) {
      this.updateCache();
      this.notify();
    }
  }

  deregister(actionIds: string[]) {
    let changed = false;
    actionIds.forEach(id => {
      if (this.actions.has(id)) {
        this.actions.delete(id);
        changed = true;
      }
    });

    if (changed) {
      this.updateCache();
      this.notify();
    }
  }

  getActions(): CommandAction[] {
    return this.cachedActions;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private updateCache() {
    this.cachedActions = Array.from(this.actions.values());
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  // For tests
  clear() {
    this.actions.clear();
    this.updateCache();
    this.notify();
  }
}

export const commandStore = new CommandStore();

export function useCommandStore() {
  return useSyncExternalStore(
    (l) => commandStore.subscribe(l),
    () => commandStore.getActions(),
    () => commandStore.getActions()
  );
}

export function useCommandActions(actions: CommandAction[]) {
  useEffect(() => {
    commandStore.register(actions);
    const ids = actions.map(a => a.id);
    return () => {
      commandStore.deregister(ids);
    };
  }, [actions]);
}