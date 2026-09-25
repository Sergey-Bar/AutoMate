import type { Meta, StoryObj } from '@storybook/react';
import { Stack } from './Stack.js';
import { Button } from '../Button/Button.js';

const meta: Meta<typeof Stack> = {
  title: 'Components/Stack',
  component: Stack,
  tags: ['autodocs'],
  argTypes: {
    direction: { control: 'select', options: ['row', 'col'] },
    gap: { control: 'select', options: [0, 1, 2, 3, 4, 6, 8] },
    align: { control: 'select', options: ['start', 'center', 'end', 'stretch'] },
    justify: { control: 'select', options: ['start', 'center', 'end', 'between'] },
  },
};

export default meta;
type Story = StoryObj<typeof Stack>;

export const Default: Story = {
  render: () => (
    <Stack>
      <Button>First</Button>
      <Button variant="secondary">Second</Button>
      <Button variant="outline">Third</Button>
    </Stack>
  ),
};

export const Row: Story = {
  render: () => (
    <Stack direction="row" gap={2}>
      <Button>First</Button>
      <Button variant="secondary">Second</Button>
      <Button variant="outline">Third</Button>
    </Stack>
  ),
};
