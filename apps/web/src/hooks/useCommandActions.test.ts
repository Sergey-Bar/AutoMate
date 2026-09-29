import { createElement } from 'react';
import { render, renderHook, act } from '@testing-library/react';
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

  it('does not loop when the caller passes a fresh array of fresh objects each render', () => {
    // The shape every caller writes: `useCommandActions([{ id, label, onSelect }])`
    // inline, which is a new array of new objects on every render.
    //
    // The hook depended on the array's *identity*, so the effect re-ran on every
    // render. Its cleanup called `deregister`, which notified; its body called
    // `register`, which notified because every object was a new reference. A
    // notification re-rendered the caller, which produced a new array, which
    // re-ran the effect — and React stopped it only by throwing "Maximum update
    // depth exceeded".
    //
    // Both hooks are needed for the loop to close. A component that registers but
    // never reads the store is not re-rendered by a notification, so the cycle
    // never forms — which is why the single-hook version of this test passed
    // against the broken code.
    let renders = 0;
    const onSelect = () => undefined;

    function Page() {
      renders += 1;
      // The real shape: register inline, and read what is registered.
      useCommandActions([{ id: 'inline', label: 'Inline', onSelect }]);
      const actions = useCommandStore();
      return createElement('span', null, actions.map((action) => action.id).join(','));
    }

    render(createElement(Page));

    expect(renders).toBeLessThanOrEqual(5);
    expect(commandStore.getActions().map((action) => action.id)).toEqual(['inline']);
  });

  it('re-registers when an action actually changes, not merely when the array does', () => {
    // The other half. If the hook simply stopped responding to a new array it
    // would also stop responding to a changed label, which is worse: the palette
    // would show yesterday's command.
    const onSelect = () => undefined;
    const { rerender } = renderHook(
      ({ label }: { label: string }) => useCommandActions([{ id: 'a', label, onSelect }]),
      { initialProps: { label: 'First' } },
    );
    expect(commandStore.getActions()[0]?.label).toBe('First');

    rerender({ label: 'Second' });
    expect(commandStore.getActions()[0]?.label).toBe('Second');
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
