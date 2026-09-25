import type { Meta, StoryObj } from '@storybook/react';
import { Toast, ToastTitle, ToastDescription } from './Toast.js';

const meta: Meta<typeof Toast> = {
  title: 'Components/Toast',
  component: Toast,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['default', 'danger', 'success', 'warning', 'info'] },
  },
};

export default meta;
type Story = StoryObj<typeof Toast>;

export const Default: Story = {
  render: () => (
    <Toast>
      <div>
        <ToastTitle>Notification</ToastTitle>
        <ToastDescription>Your changes have been saved.</ToastDescription>
      </div>
    </Toast>
  ),
};

export const Success: Story = {
  render: () => (
    <Toast variant="success">
      <div>
        <ToastTitle>Success</ToastTitle>
        <ToastDescription>Test run completed successfully.</ToastDescription>
      </div>
    </Toast>
  ),
};

export const Danger: Story = {
  render: () => (
    <Toast variant="danger">
      <div>
        <ToastTitle>Error</ToastTitle>
        <ToastDescription>Failed to connect to the server.</ToastDescription>
      </div>
    </Toast>
  ),
};

export const Warning: Story = {
  render: () => (
    <Toast variant="warning">
      <div>
        <ToastTitle>Warning</ToastTitle>
        <ToastDescription>Some tests are flaky.</ToastDescription>
      </div>
    </Toast>
  ),
};
