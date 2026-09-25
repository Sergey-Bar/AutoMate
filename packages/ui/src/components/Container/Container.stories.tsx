import type { Meta, StoryObj } from '@storybook/react';
import { Container } from './Container.js';

const meta: Meta<typeof Container> = {
  title: 'Components/Container',
  component: Container,
  tags: ['autodocs'],
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg', 'full'] },
  },
};

export default meta;
type Story = StoryObj<typeof Container>;

export const Default: Story = {
  render: () => (
    <Container>
      <p>Content inside a default (lg) container.</p>
    </Container>
  ),
};

export const Small: Story = {
  render: () => (
    <Container size="sm">
      <p>Content inside a small container.</p>
    </Container>
  ),
};
