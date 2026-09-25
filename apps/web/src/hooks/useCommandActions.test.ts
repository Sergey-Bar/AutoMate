import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useCommandActions, useCommandStore, commandStore } from './useCommandActions.js';

describe('useCommandActions', () => {
  beforeEach(() => {
    commandStore.clear();
  });

  it('registers and deregisters actions', () => {
    const actions = [
      { id: '1', label: 'One', onSelect: () => {} },
      { id: '2', label: 'Two', onSelect: () => {} },
    ];

    const { unmount } = renderHook(() => useCommandActions(actions));

    let currentActions = commandStore.getActions();
    expect(currentActions).toHaveLength(2);
    expect(currentActions[0].id).toBe('1');
    expect(currentActions[1].id).toBe('2');

    unmount();

    currentActions = commandStore.getActions();
    expect(currentActions).toHaveLength(0);
  });

  it('limits to 50 actions', () => {
    const actions = Array.from({ length: 60 }).map((_, i) => ({
      id: `id-${i}`,
      label: `Label ${i}`,
      onSelect: () => {},
    }));

    renderHook(() => useCommandActions(actions));

    const currentActions = commandStore.getActions();
    expect(currentActions).toHaveLength(50);
    // Should keep the last 50, so starting from id-10
    expect(currentActions[0].id).toBe('id-10');
  });

  it('useCommandStore hook returns reactive actions', () => {
    const { result } = renderHook(() => useCommandStore());

    expect(result.current).toHaveLength(0);

    act(() => {
      commandStore.register([{ id: 'test', label: 'Test', onSelect: () => {} }]);
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe('test');
  });
});
