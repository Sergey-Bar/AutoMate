import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './Tabs.js';

const meta: Meta<typeof Tabs> = {
  title: 'Components/Tabs',
  component: Tabs,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Tabs>;

function TabsDemo() {
  const [value, setValue] = useState('overview');
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="tests">Tests</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <p style={{ padding: '1rem' }}>Overview content</p>
      </TabsContent>
      <TabsContent value="tests">
        <p style={{ padding: '1rem' }}>Tests content</p>
      </TabsContent>
      <TabsContent value="settings">
        <p style={{ padding: '1rem' }}>Settings content</p>
      </TabsContent>
    </Tabs>
  );
}

export const Default: Story = {
  render: () => <TabsDemo />,
};
