import type { Meta, StoryObj } from '@storybook/react';
import { Grid } from './Grid.js';
import { Card } from '../Card/Card.js';

const meta: Meta<typeof Grid> = {
  title: 'Components/Grid',
  component: Grid,
  tags: ['autodocs'],
  argTypes: {
    cols: { control: 'select', options: [1, 2, 3, 4, 6, 12] },
    gap: { control: 'select', options: [0, 1, 2, 3, 4, 6, 8] },
  },
};

export default meta;
type Story = StoryObj<typeof Grid>;

export const Default: Story = {
  render: () => (
    <Grid cols={3} gap={4}>
      <Card style={{ padding: '1rem' }}>Item 1</Card>
      <Card style={{ padding: '1rem' }}>Item 2</Card>
      <Card style={{ padding: '1rem' }}>Item 3</Card>
    </Grid>
  ),
};

export const TwoColumns: Story = {
  render: () => (
    <Grid cols={2} gap={4}>
      <Card style={{ padding: '1rem' }}>Left</Card>
      <Card style={{ padding: '1rem' }}>Right</Card>
    </Grid>
  ),
};
