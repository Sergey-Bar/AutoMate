import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs.js';

test('renders tabs and handles clicking', () => {
  const onValueChange = vi.fn();
  render(
    <Tabs value="tab1" onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">Content 1</TabsContent>
      <TabsContent value="tab2">Content 2</TabsContent>
    </Tabs>
  );

  expect(screen.getByText('Content 1')).toBeInTheDocument();
  expect(screen.queryByText('Content 2')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Tab 2'));
  expect(onValueChange).toHaveBeenCalledWith('tab2');
});

test('handles keyboard navigation', () => {
  const onValueChange = vi.fn();
  render(
    <Tabs value="tab1" onValueChange={onValueChange}>
      <TabsList>
        <TabsTrigger value="tab1">Tab 1</TabsTrigger>
        <TabsTrigger value="tab2">Tab 2</TabsTrigger>
        <TabsTrigger value="tab3">Tab 3</TabsTrigger>
      </TabsList>
      <TabsContent value="tab1">Content 1</TabsContent>
      <TabsContent value="tab2">Content 2</TabsContent>
      <TabsContent value="tab3">Content 3</TabsContent>
    </Tabs>
  );

  const tab1 = screen.getByText('Tab 1');
  tab1.focus();

  fireEvent.keyDown(tab1, { key: 'ArrowRight' });
  expect(onValueChange).toHaveBeenCalledWith('tab2');

  fireEvent.keyDown(tab1, { key: 'ArrowLeft' });
  expect(onValueChange).toHaveBeenCalledWith('tab3'); // wrap around
});
