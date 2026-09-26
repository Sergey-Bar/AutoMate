import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from './Drawer.js';
import { Button } from '../Button/Button.js';

const meta: Meta<typeof Drawer> = {
  title: 'Components/Drawer',
  component: Drawer,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Drawer>;

function DrawerDemo({ position }: { position?: 'left' | 'right' | 'top' | 'bottom' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open Drawer ({position ?? 'right'})</Button>
      <Drawer open={open} onOpenChange={setOpen} position={position}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Drawer Title</DrawerTitle>
          </DrawerHeader>
          <p style={{ marginTop: '1rem' }}>Drawer content goes here.</p>
          <Button
            variant="outline"
            size="sm"
            style={{ marginTop: '1rem' }}
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </DrawerContent>
      </Drawer>
    </>
  );
}

export const Default: Story = {
  render: () => <DrawerDemo />,
};

export const Left: Story = {
  render: () => <DrawerDemo position="left" />,
};
