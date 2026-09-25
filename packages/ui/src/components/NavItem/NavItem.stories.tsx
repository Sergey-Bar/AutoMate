import type { Meta, StoryObj } from '@storybook/react';
import { Home, Settings, BarChart2, Bell } from 'lucide-react';
import { NavItem } from './NavItem.js';

const meta: Meta<typeof NavItem> = {
  title: 'Components/NavItem',
  component: NavItem,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof NavItem>;

export const Default: Story = {
  args: {
    label: 'Dashboard',
    href: '#',
  },
};

export const Active: Story = {
  args: {
    label: 'Dashboard',
    href: '#',
    active: true,
    icon: <Home size={16} />,
  },
};

export const WithIcon: Story = {
  args: {
    label: 'Settings',
    href: '#',
    icon: <Settings size={16} />,
  },
};

export const WithBadge: Story = {
  args: {
    label: 'Notifications',
    href: '#',
    icon: <Bell size={16} />,
    badge: 5,
  },
};

export const NavGroup: Story = {
  render: () => (
    <div style={{ width: 240, display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <NavItem label="Dashboard" href="#" icon={<Home size={16} />} active />
      <NavItem label="Analytics" href="#" icon={<BarChart2 size={16} />} />
      <NavItem label="Settings" href="#" icon={<Settings size={16} />} />
      <NavItem label="Notifications" href="#" icon={<Bell size={16} />} badge={3} />
    </div>
  ),
};
