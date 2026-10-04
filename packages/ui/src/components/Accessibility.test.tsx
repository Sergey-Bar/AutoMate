import { readFileSync, readdirSync, statSync } from 'node:fs';
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
import {
  DefinitionList,
  DefinitionListDetail,
  DefinitionListTerm,
} from './DefinitionList/DefinitionList.js';
import { EmptyState } from './EmptyState/EmptyState.js';
import { Grid } from './Grid/Grid.js';
import { Input } from './Input/Input.js';
import { Label } from './Label/Label.js';
import { NavItem } from './NavItem/NavItem.js';
import { Popover, PopoverContent, PopoverTrigger } from './Popover/Popover.js';
import { Meter } from './Meter/Meter.js';
import { Select } from './Select/Select.js';
import { Sparkline } from './Sparkline/Sparkline.js';
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
        {/*
          `Input`, not a bare `<input>`. The focus sweep asks "does every element in the tab
          order carry the idiom", so a hand-written `<input>` with no classes in the fixture
          would have been a defect in the fixture rather than in the product — and a test
          that reports its own fixture is a test nobody reads.
        */}
        <Input id="labelled-input" />
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
  { name: 'Meter', element: <Meter label="Backend coverage" value={0.72} /> },
  {
    name: 'Sparkline',
    element: <Sparkline points={[0.1, 0.4, 0.35, 0.8]} label="Pass rate, last 4 runs" />,
  },
  {
    name: 'DefinitionList',
    element: (
      <DefinitionList>
        <DefinitionListTerm>Capping value</DefinitionListTerm>
        <DefinitionListDetail>0.42</DefinitionListDetail>
        <DefinitionListTerm>Cheapest closure</DefinitionListTerm>
        <DefinitionListDetail>Add the missing contract test</DefinitionListDetail>
      </DefinitionList>
    ),
  },
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

/** Every shipped component module, as `{ name, body }`, excluding tests and stories. */
function componentSources(): Array<{ name: string; body: string }> {
  return shippedComponentNames().flatMap((name) =>
    readdirSync(path.join(componentsDir, name))
      .filter(
        (entry) =>
          entry.endsWith('.tsx') && !entry.includes('.test.') && !entry.includes('.stories.'),
      )
      .map((entry) => ({
        name: `${name}/${entry}`,
        body: readFileSync(path.join(componentsDir, name, entry), 'utf8'),
      })),
  );
}

/**
 * A source file with its block comments removed.
 *
 * The rules below are about *class names*, and a comment that explains why `leading-none` is
 * wrong says the word `leading-none`. Matching the raw file meant the fix could not be
 * documented — which is how a repository ends up with a comment naming a class and a check
 * that forbids the comment.
 *
 * Only block comments are stripped. Line comments are left alone deliberately: a `//` inside
 * a string literal is a URL, and eating the rest of that line would delete a class name from
 * the middle of the file.
 */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}
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
    expect(shipped.length).toBe(31);
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

/**
 * One focus idiom, on one token.
 *
 * **Eleven components shipped three.** `Button`, `Input`, `Select`, `Textarea`, `Toggle`
 * and `Table` used the canonical
 * `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus`;
 * `Badge` used `focus:ring-2 focus:ring-accent`, which fires on mouse press as well as on
 * keyboard focus and is a ring rather than the outline the rest of the product draws;
 * `Tabs` used `ring-brand-500`, which is **Tailwind's default palette** — a second colour
 * authority in a repository where a colour that is not a token is a test failure everywhere
 * else, compiling today only because Tailwind ships a `brand` scale nobody declared; and
 * `Popover` wrote `outline-none` with nothing in its place. `NavItem`, `Breadcrumbs`,
 * `Tooltip` and `Splitter` drew no focus indicator at all, and the application's own
 * `ThemeToggle` drew a third idiom in `apps/web/src/Accessibility.test.tsx`.
 *
 * The assertion is on the rendered DOM rather than on the source, because the defect is what
 * a person tabs to: every element in the tab order has to carry the same ring, and an
 * element can only be skipped by being out of the tab order.
 *
 * `tabIndex={-1}` elements are excluded and the exclusion is the point — a dialog routinely
 * contains a programmatically focusable panel, and "focusable" is not the same question as
 * "in the tab order".
 */
const FOCUS_IDIOM = ['focus-visible:outline-2', 'focus-visible:outline-border-focus'] as const;

/**
 * The offset, which is the one part of the idiom that varies.
 *
 * `focus-visible:outline-offset-2` draws the ring outside the element, which is right for a
 * control in a panel with room around it. The command palette's search field sits flush
 * against the panel's top edge under an `overflow-hidden`, and an outward 2px ring would be
 * clipped away — so it draws the ring *inward* with `focus-visible:outline-offset-[-2px]`.
 *
 * Both are declared here rather than the second being waved through: a ring clipped by its
 * own container is a ring nobody can see, which is the defect this whole block is about,
 * and the fix has to be a decision somebody wrote down.
 */
const FOCUS_OFFSETS = [
  'focus-visible:outline-offset-2',
  'focus-visible:outline-offset-[-2px]',
] as const;

/** Everything a keyboard user can land on. */
const IN_TAB_ORDER =
  'a[href], button, input, select, textarea, [role="switch"], [role="tab"], [tabindex]';

function tabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(IN_TAB_ORDER)).filter((element) => {
    if (element.getAttribute('tabindex') === '-1') return false;
    if (element.hasAttribute('disabled')) return false;
    if (element.getAttribute('aria-hidden') === 'true') return false;
    return true;
  });
}

/**
 * The peer form of the idiom, for a control whose visible surface is a sibling of the
 * focusable element. `Toggle` is the only one: the `<input>` is `sr-only` and the track
 * beside it is what a person sees, so the track carries `peer-focus-visible:*`.
 */
function carriesFocusIdiom(element: HTMLElement): boolean {
  const has = (utility: string, target: HTMLElement): boolean =>
    target.classList.contains(utility) ||
    target.classList.contains(utility.replace('focus-visible:', 'peer-focus-visible:'));
  const onItself = (target: HTMLElement): boolean =>
    FOCUS_IDIOM.every((utility) => has(utility, target)) &&
    FOCUS_OFFSETS.some((offset) => has(offset, target));
  if (onItself(element)) return true;
  // The peer form, checked on the *following* siblings rather than assumed.
  //
  // `Toggle` is the only component where the focusable element is not the visible surface.
  // `peer-*` only styles a following sibling, so walking forward is the shape the CSS has
  // rather than a guess.
  for (
    let sibling = element.nextElementSibling;
    sibling !== null;
    sibling = sibling.nextElementSibling
  ) {
    if (onItself(sibling as HTMLElement)) return true;
  }
  return false;
}

describe('one focus idiom, on one token', () => {
  it('proves the sweep can see a control with no focus indicator', () => {
    const { container } = render(<button type="button">Queue a run</button>);
    expect(carriesFocusIdiom(container.querySelector('button') as HTMLElement)).toBe(false);
  });

  it('rejects a ring in place of the outline, because a ring is a different idiom', () => {
    const { container } = render(
      <button type="button" className="focus:ring-2 focus:ring-accent">
        Queue a run
      </button>,
    );
    expect(carriesFocusIdiom(container.querySelector('button') as HTMLElement)).toBe(false);
  });

  it.each(CASES)('$name gives every element in the tab order the same ring', ({ element }) => {
    const { container, unmount } = render(element);
    const offenders = tabbable(container)
      .filter((candidate) => !carriesFocusIdiom(candidate))
      .map((candidate) => {
        const label =
          candidate.textContent?.trim().slice(0, 24) ||
          candidate.getAttribute('aria-label') ||
          candidate.tagName.toLowerCase();
        return `${candidate.tagName.toLowerCase()}"${label}" [${candidate.className}]`;
      });
    unmount();
    expect(
      offenders,
      `every element in the tab order must carry ${[...FOCUS_IDIOM, ...FOCUS_OFFSETS].join(' ')} — one idiom, on --automate-accent, drawn as an outline`,
    ).toEqual([]);
  });

  it('names no Tailwind default-palette colour in a focus position', () => {
    // `ring-brand-500` compiled for a year because Tailwind ships a `brand` scale. The
    // compile-side half of this is `theme-resolution.test.ts`; this is the source half,
    // and it fails on the name rather than on what it resolves to.
    const sources = componentSources();
    const offenders = sources
      .filter((source) =>
        /(focus|focus-visible|peer-focus-visible):[^\s"']*brand-/.test(source.body),
      )
      .map((source) => source.name);
    expect(offenders, 'a focus indicator is pointing at a Tailwind default, not a token').toEqual(
      [],
    );
  });

  it('leaves no focus-visible:outline-none with nothing in its place', () => {
    const sources = componentSources();
    const offenders = sources
      .filter((source) => /focus-visible:outline-none/.test(codeOf(source.body)))
      // `Tabs`' panel sets it and then draws a ring; a suppression with a replacement is
      // legitimate. A suppression on its own is the defect `Popover` shipped.
      .filter((source) => !/(ring-|outline-border-focus|outline-2)/.test(codeOf(source.body)))
      .map((source) => source.name);
    expect(
      offenders,
      'outline-none with no replacement leaves a keyboard user with no ring',
    ).toEqual([]);
  });
});

/**
 * Typography, as two properties a reading console cannot get wrong.
 *
 * ## Figures do not move
 *
 * A digit is proportional by default, so a column of figures shifts sideways every time one
 * of them changes — which in this product is most refreshes. The documentation site has set
 * `tabular-nums` on its table cells since it was written; the product set it nowhere, which
 * is the inversion the design's own thesis calls out: *evidence is an instrument reading*.
 *
 * The assertion is on the **rendered DOM**, and it asks the question a reader's eye asks:
 * every element whose entire content is a figure must be drawn in tabular numerals. Not "the
 * component has the class somewhere" — that would pass for a `StatCard` whose class sat on a
 * wrapper. Every element *that is the figure* carries it, itself or on an ancestor.
 *
 * ## Headings do not clip
 *
 * `leading-none` is `line-height: 1`, which clips the descender of any glyph that has one
 * and does nothing correct at any size. Four headings shipped it — `Card`, `Drawer`, `Dialog`
 * and `Alert` — and `Label` shipped it too, which is the one place it is least defensible: a
 * 14px label with a line box of 1 has no room for a descender at all.
 *
 * What replaces it is a **declared** step from the line-height scale in `theme.css`, not an
 * arbitrary value, because a component writing `leading-[1.3]` is writing a number the
 * stylesheet does not own. `leading-snug` (1.375) for a heading and `leading-tight` (1.25)
 * for the label: the label is a single line by construction, so it can sit tighter.
 */

/**
 * Is this string a figure?
 *
 * **Written as a reader rather than a regex, deliberately.** The obvious shape nests an
 * optional group behind a `+`, which is the exact backtracking shape
 * `security/detect-unsafe-regex` refuses, and the rule is right to.
 * `theme.test.ts`'s `isSizeArgument` already answers that rule the same way, by reading the
 * suffix and then asking `Number` about the rest, so this is the house answer rather than a
 * new one.
 *
 * The accepted set is deliberately small: a sign, digits with thousands and decimal
 * separators, and one of four suffixes. `run-1` is not a figure, neither is an empty string,
 * and a lone `%` is not a figure either.
 */
function isFigureText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  let body = trimmed;
  for (const suffix of ['%', '\u00d7', 'pts', 'pt']) {
    if (body.endsWith(suffix)) {
      body = body.slice(0, -suffix.length).trimEnd();
      break;
    }
  }
  if (body.length === 0) return false;
  const signless =
    body.startsWith('+') || body.startsWith('-') || body.startsWith('\u2212')
      ? body.slice(1)
      : body;
  if (signless.length === 0) return false;
  // At least one digit, and nothing but digits and separators — two passes over a fixed
  // alphabet rather than one pattern, which is the property the rule wants.
  let digits = 0;
  for (const character of signless) {
    if (character >= '0' && character <= '9') {
      digits += 1;
      continue;
    }
    if (character === '.' || character === ',') continue;
    return false;
  }
  return digits > 0;
}

function isFigure(element: HTMLElement): boolean {
  if (element.children.length > 0) return false;
  return isFigureText(element.textContent ?? '');
}

/** True when `element` or anything above it draws in tabular numerals. */
function withinTabularNumerals(element: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    if (node.classList.contains('tabular-nums')) return true;
    if (node === root) break;
  }
  return false;
}

describe('figures do not move when they change', () => {
  it('proves the sweep can see a figure that is not in tabular numerals', () => {
    const { container } = render(<span>98.4%</span>);
    const figure = container.querySelector('span') as HTMLElement;
    expect(isFigure(figure)).toBe(true);
    expect(withinTabularNumerals(figure, container)).toBe(false);
  });

  it.each(CASES)('$name sets every figure it renders in tabular numerals', ({ element }) => {
    const { container, unmount } = render(element);
    const offenders = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .filter((candidate) => isFigure(candidate))
      .filter((candidate) => !withinTabularNumerals(candidate, container))
      .map((candidate) => `${candidate.tagName.toLowerCase()}"${candidate.textContent?.trim()}"`);
    unmount();
    expect(
      offenders,
      'a figure that is not in tabular numerals shifts sideways as it updates, which is the ' +
        'most visible craft defect a data console can have and the cheapest to fix',
    ).toEqual([]);
  });
});

describe('headings do not clip their own descenders', () => {
  it('proves the sweep can see leading-none on a heading', () => {
    const { container } = render(<h3 className="leading-none">Release readiness</h3>);
    const heading = container.querySelector('h3') as HTMLElement;
    expect(componentSources().some((source) => /leading-none/.test(codeOf(source.body)))).toBe(
      true,
    );
    expect(heading.classList.contains('leading-none')).toBe(true);
  });

  it('writes leading-none on nothing but the sort indicator', () => {
    // `Table`'s sort arrows are `leading-none` and are correct: they are two 10px triangles
    // in a flex column, and a line box of 1 is what keeps them tight. Every other use in
    // this repository was on text a person reads.
    const offenders = componentSources()
      .filter((source) => /leading-none/.test(codeOf(source.body)))
      .filter((source) => source.name !== 'Table/Table.tsx')
      .map((source) => source.name);
    expect(
      offenders,
      '`leading-none` is `line-height: 1`. It clips the descender of any glyph that has one ' +
        'and is correct at no text size. Use a declared step from the line-height scale.',
    ).toEqual([]);
  });

  it.each([
    ['Card', 'Card/Card.tsx'],
    ['Dialog', 'Dialog/Dialog.tsx'],
    ['Drawer', 'Drawer/Drawer.tsx'],
    ['Alert', 'Alert/Alert.tsx'],
    ['Label', 'Label/Label.tsx'],
  ])('%s sets its heading line-height from the declared scale', (_name, file) => {
    const source = componentSources().find((candidate) => candidate.name === file);
    expect(source, `no component source named ${file}`).toBeDefined();
    const declared = [...codeOf(source?.body ?? '').matchAll(/(?:leading|text)-[a-z0-9-]+/g)].map(
      (match) => match[0],
    );
    expect(
      declared.some((utility) => utility.startsWith('leading-')),
      `${file} sets no line-height, so the heading takes the browser's default rather than one of the six steps theme.css declares.`,
    ).toBe(true);
  });
});

describe('prose is wrapped deliberately and data is not', () => {
  it('balances a heading and prettifies a description', () => {
    // Four declarations, four jobs, and the two that matter for a console are cheap:
    // `text-wrap: balance` on a heading so a two-line title does not leave one word on the
    // second line, `text-wrap: pretty` on a description so the last line is not a single
    // short word.
    const sources = componentSources();
    const balanced = sources.filter((source) => /text-balance/.test(codeOf(source.body)));
    const prettied = sources.filter((source) => /text-pretty/.test(codeOf(source.body)));
    expect(
      balanced.map((source) => source.name),
      'no component balances a heading',
    ).not.toEqual([]);
    expect(
      prettied.map((source) => source.name),
      'no component prettifies a description',
    ).not.toEqual([]);
  });

  it('caps prose at the declared measure and never caps a figure', () => {
    // `--max-w-measure` is 68ch and it is a ceiling on *prose*. A table, a score, a stack
    // trace and a run log are not prose, and capping a column of figures would leave a
    // hundred pixels of empty line to the right of the instrument. So the rule is: the
    // measure reaches the components that carry sentences, and no component renders a figure
    // inside one.
    //
    // This assertion found `DefinitionListDetail` mid-wave: a `<dd>` in this product holds a
    // digest, a path or a sentence, so capping it would be capping a figure as though it were
    // a sentence. The primitive dropped the measure rather than the rule being weakened.
    const sources = componentSources();
    const withMeasure = sources
      .filter((source) => /max-w-measure/.test(codeOf(source.body)))
      .map((source) => source.name);
    expect(withMeasure, 'the measure is declared and nothing uses it').not.toEqual([]);
    for (const name of withMeasure) {
      const source = sources.find((candidate) => candidate.name === name);
      expect(
        codeOf(source?.body ?? ''),
        `${name} caps itself at the measure and also renders a figure, so a number is being capped as though it were a sentence.`,
      ).not.toMatch(/tabular-nums/);
    }
  });
});
