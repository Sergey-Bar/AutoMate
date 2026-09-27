import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { expectNoBlockingAxeViolations } from '../test/axe.js';
import { Alert, AlertDescription, AlertTitle } from './Alert/Alert.js';
import { AppShell } from './AppShell/AppShell.js';
import { Avatar, AvatarFallback, AvatarImage } from './Avatar/Avatar.js';
import { Badge } from './Badge/Badge.js';
import { Breadcrumbs } from './Breadcrumbs/Breadcrumbs.js';
import { Button } from './Button/Button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './Card/Card.js';
import { CommandPalette } from './CommandPalette/CommandPalette.js';
import { Container } from './Container/Container.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './Dialog/Dialog.js';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from './Drawer/Drawer.js';
import { EmptyState } from './EmptyState/EmptyState.js';
import { Grid } from './Grid/Grid.js';
import { Input } from './Input/Input.js';
import { Label } from './Label/Label.js';
import { NavItem } from './NavItem/NavItem.js';
import { Popover, PopoverContent, PopoverTrigger } from './Popover/Popover.js';
import { Select } from './Select/Select.js';
import { Skeleton } from './Skeleton/Skeleton.js';
import { Splitter } from './Splitter/Splitter.js';
import { Stack } from './Stack/Stack.js';
import { StatCard } from './StatCard/StatCard.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table/Table.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './Tabs/Tabs.js';
import { Textarea } from './Textarea/Textarea.js';
import { Toast, ToastDescription, ToastTitle } from './Toast/Toast.js';
import { Toggle } from './Toggle/Toggle.js';
import { Tooltip } from './Tooltip/Tooltip.js';

/**
 * jsdom has no `<dialog>` implementation — `showModal` is absent and jsdom
 * logs a "not implemented" error rather than throwing — so every surface built
 * on one is stubbed here. The stubs dispatch the real `close` event so the
 * focus-restore path the component listens for actually runs.
 */
function stubDialogElement(): void {
  HTMLDialogElement.prototype.showModal = vi.fn(function mock(this: HTMLDialogElement) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function mock(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  });
}

beforeEach(() => {
  stubDialogElement();
});

const componentsDir = path.join(path.dirname(fileURLToPath(import.meta.url)));

/**
 * One representative render per shipped component.
 *
 * Written by hand rather than generated, because a generated fixture proves only
 * that the generator ran. Every entry is the real component with real props; the
 * sweep below then asserts the list has not fallen behind the directory, so a new
 * component cannot ship with no axe assertion.
 */
const CASES: ReadonlyArray<{ name: string; element: ReactElement }> = [
  {
    name: 'Alert',
    element: (
      <Alert variant="danger">
        <AlertTitle>Run store unavailable</AlertTitle>
        <AlertDescription>Persisted evidence is not being served.</AlertDescription>
      </Alert>
    ),
  },
  {
    name: 'AppShell',
    element: (
      <AppShell
        header={<span>Command Center</span>}
        sidebar={<span>Navigation</span>}
        footer={<span>Footer</span>}
      >
        <p>Main region</p>
      </AppShell>
    ),
  },
  {
    name: 'Avatar',
    element: (
      <Avatar>
        <AvatarImage src="/avatar.png" alt="Sergey" />
        <AvatarFallback>SR</AvatarFallback>
      </Avatar>
    ),
  },
  { name: 'Badge', element: <Badge variant="success">PASSED</Badge> },
  {
    name: 'Breadcrumbs',
    element: (
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Runs', href: '/dashboard/runs' },
          { label: 'run-1' },
        ]}
      />
    ),
  },
  { name: 'Button', element: <Button variant="primary">Queue browser run</Button> },
  {
    name: 'Card',
    element: (
      <Card>
        <CardHeader>
          <CardTitle>Release readiness</CardTitle>
          <CardDescription>Persisted gate evidence</CardDescription>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>
    ),
  },
  {
    name: 'CommandPalette',
    element: (
      <CommandPalette
        open
        actions={[{ id: 'nav-dashboard', label: 'Go to Command Center', onSelect: () => {} }]}
      />
    ),
  },
  { name: 'Container', element: <Container>Container</Container> },
  {
    name: 'Dialog',
    element: (
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel run</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    ),
  },
  {
    name: 'Drawer',
    element: (
      <Drawer open>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filters</DrawerTitle>
          </DrawerHeader>
        </DrawerContent>
      </Drawer>
    ),
  },
  {
    name: 'EmptyState',
    element: (
      <EmptyState
        title="No release evidence"
        description="The system will not infer a passing release."
        action={<Button>Queue a run</Button>}
      />
    ),
  },
  {
    name: 'Grid',
    element: (
      <Grid cols={2} gap={4}>
        <span>One</span>
        <span>Two</span>
      </Grid>
    ),
  },
  {
    name: 'Input',
    element: <Input id="run-project" label="Project ID" helperText="Registered project" />,
  },
  {
    name: 'Label',
    element: (
      <>
        <Label htmlFor="labelled-input">Project ID</Label>
        <input id="labelled-input" />
      </>
    ),
  },
  {
    name: 'NavItem',
    element: <NavItem href="/dashboard" label="Command Center" active badge={3} />,
  },
  {
    name: 'Popover',
    element: (
      <Popover>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>Filter panel</PopoverContent>
      </Popover>
    ),
  },
  {
    name: 'Select',
    element: (
      <Select
        id="run-status"
        label="Run status"
        options={[
          { value: 'passed', label: 'Passed' },
          { value: 'failed', label: 'Failed' },
        ]}
      />
    ),
  },
  { name: 'Skeleton', element: <Skeleton variant="text" /> },
  { name: 'Splitter', element: <Splitter value={40} /> },
  {
    name: 'Stack',
    element: (
      <Stack direction="row" gap={2}>
        <span>One</span>
        <span>Two</span>
      </Stack>
    ),
  },
  {
    name: 'StatCard',
    element: <StatCard title="Pass rate" value="98.4%" trend="up" description="Last 7 days" />,
  },
  {
    name: 'Table',
    element: (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead sortable sortDirection="asc" onSortChange={() => {}}>
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>run-1</TableCell>
            <TableCell>passed</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    ),
  },
  {
    name: 'Tabs',
    element: (
      <Tabs value="runs" onValueChange={() => {}}>
        <TabsList>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="quarantine">Quarantine</TabsTrigger>
        </TabsList>
        <TabsContent value="runs">Run list</TabsContent>
        <TabsContent value="quarantine">Quarantine list</TabsContent>
      </Tabs>
    ),
  },
  { name: 'Textarea', element: <Textarea id="selection" label="Test path selection" /> },
  {
    name: 'Toast',
    element: (
      <Toast variant="success">
        <ToastTitle>Run queued</ToastTitle>
        <ToastDescription>run-1 is waiting for a runner.</ToastDescription>
      </Toast>
    ),
  },
  { name: 'Toggle', element: <Toggle id="live-updates" label="Live updates" checked /> },
  { name: 'Tooltip', element: <Tooltip content="Retry the run">Retry</Tooltip> },
];

/**
 * Every component directory under `src/components`.
 *
 * Compared against {@link CASES} so a component added later fails this suite
 * until it has an axe assertion, rather than quietly escaping the sweep.
 */
function shippedComponentNames(): string[] {
  const root = componentsDir;
  return readdirSync(root)
    .filter((entry) => statSync(path.join(root, entry)).isDirectory())
    .filter((entry) => existsComponentSource(path.join(root, entry)))
    .sort();
}

function existsComponentSource(directory: string): boolean {
  return readdirSync(directory).some(
    (entry) => entry.endsWith('.tsx') && !entry.includes('.test.'),
  );
}

describe('axe sweep over every shipped component', () => {
  it('covers every component directory that ships a component', () => {
    const shipped = shippedComponentNames();
    const covered = CASES.map((testCase) => testCase.name).sort();
    expect(shipped.length).toBe(28);
    // Guards the case list below: a missing or extra entry fails here, with the
    // diff, rather than as a silently smaller sweep.
    expect(covered).toEqual(shipped);
  });

  it.each(CASES)('$name has no serious or critical axe violations', async ({ element }) => {
    const { container, unmount } = render(element);
    await expectNoBlockingAxeViolations(container);
    unmount();
  });
});

describe('axe on the interactive states that only exist at runtime', () => {
  /**
   * The whole value of the sweep above is that it fails when something is wrong.
   * A hand-built control with no accessible name is the classic serious
   * violation, so if this passes silently the sweep is decoration and every
   * green run of it is meaningless.
   */
  it('proves the sweep can see a real violation', async () => {
    const { container } = render(<button data-testid="unnamed" />);
    await expect(expectNoBlockingAxeViolations(container)).rejects.toThrow(/button-name/);
  });

  it('reports no violations for an open popover with its panel revealed', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Popover>
        <PopoverTrigger>Filters</PopoverTrigger>
        <PopoverContent>
          <Button>Apply</Button>
        </PopoverContent>
      </Popover>,
    );
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for a command palette with a filtered result list', async () => {
    const { container } = render(
      <CommandPalette
        open
        actions={[
          { id: '1', label: 'Create new project', onSelect: () => {} },
          { id: '2', label: 'Settings', onSelect: () => {} },
        ]}
      />,
    );
    await expectNoBlockingAxeViolations(container);
  });

  it('reports no violations for an input carrying a validation error', async () => {
    const { container } = render(
      <Input id="branch" label="Branch" error="Branch is not registered" />,
    );
    await expectNoBlockingAxeViolations(container);
  });
});
