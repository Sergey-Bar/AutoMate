import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { CommandPalette } from './CommandPalette.js';
import { Button } from '../Button/Button.js';

const meta: Meta<typeof CommandPalette> = {
  title: 'Components/CommandPalette',
  component: CommandPalette,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof CommandPalette>;

const actions = [
  { id: 'new-run', label: 'New Test Run', onSelect: () => alert('New run') },
  { id: 'view-runs', label: 'View All Runs', onSelect: () => alert('View runs') },
  { id: 'settings', label: 'Open Settings', onSelect: () => alert('Settings') },
  { id: 'docs', label: 'View Documentation', onSelect: () => alert('Docs') },
];

function CommandPaletteDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Open Command Palette (Ctrl+K)
      </Button>
      <CommandPalette actions={actions} open={open} onOpenChange={setOpen} />
    </>
  );
}

export const Default: Story = {
  render: () => <CommandPaletteDemo />,
};
