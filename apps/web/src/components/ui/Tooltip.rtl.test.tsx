import { render, screen, fireEvent, act } from '../../test/test-utils.js';
import { Tooltip } from './Tooltip.js';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders children without showing tooltip initially', () => {
    render(
      <Tooltip content="Hover me">
        <button>Trigger</button>
      </Tooltip>,
    );

    expect(screen.getByRole('button', { name: 'Trigger' })).toBeInTheDocument();
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip after mouseenter + delay', () => {
    render(
      <Tooltip content="Helpful tip" delay={300}>
        <button>Hover target</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole('button', { name: 'Hover target' }).parentElement!;
    fireEvent.mouseEnter(wrapper);

    // Tooltip not yet visible before delay
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(300); });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Helpful tip');
  });

  it('hides tooltip on mouseleave (tooltip becomes opacity:0 during exit)', () => {
    render(
      <Tooltip content="Gone on leave" delay={0}>
        <button>Target</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole('button', { name: 'Target' }).parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(0); });

    // Tooltip is rendered in the DOM after open
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Gone on leave');

    fireEvent.mouseLeave(wrapper);

    // After hide, framer-motion AnimatePresence transitions to opacity:0 before unmounting
    // The element stays in DOM during exit animation with opacity:0
    expect(screen.getByRole('tooltip')).toHaveStyle({ opacity: '0' });
  });

  it('shows tooltip on focus', () => {
    render(
      <Tooltip content="Focus tip" delay={0}>
        <button>Focusable</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole('button', { name: 'Focusable' }).parentElement!;
    fireEvent.focus(wrapper);
    act(() => { vi.advanceTimersByTime(0); });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Focus tip');
  });

  it('hides tooltip on blur (tooltip becomes opacity:0 during exit)', () => {
    render(
      <Tooltip content="Blur hides me" delay={0}>
        <button>Focusable</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole('button', { name: 'Focusable' }).parentElement!;
    fireEvent.focus(wrapper);
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.blur(wrapper);

    // framer-motion exit: tooltip fades to opacity:0 before DOM removal
    expect(screen.getByRole('tooltip')).toHaveStyle({ opacity: '0' });
  });

  it('cancels pending show when mouseleave fires before delay expires', () => {
    render(
      <Tooltip content="Should not appear" delay={500}>
        <button>Quick hover</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole('button', { name: 'Quick hover' }).parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(200); });

    // Leave before delay completes — timer should be cancelled
    fireEvent.mouseLeave(wrapper);
    act(() => { vi.advanceTimersByTime(500); });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('uses default delay of 300ms when delay prop is omitted', () => {
    render(
      <Tooltip content="Default delay">
        <span>Target</span>
      </Tooltip>,
    );

    const wrapper = screen.getByText('Target').parentElement!;
    fireEvent.mouseEnter(wrapper);

    act(() => { vi.advanceTimersByTime(299); });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('renders ReactNode content inside tooltip', () => {
    render(
      <Tooltip content={<strong>Rich content</strong>} delay={0}>
        <button>Node target</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole('button', { name: 'Node target' }).parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(0); });

    expect(screen.getByRole('tooltip').querySelector('strong')).toBeInTheDocument();
  });

  it('renders with side="bottom" (does not throw)', () => {
    render(
      <Tooltip content="Bottom tip" side="bottom" delay={0}>
        <button>Bottom</button>
      </Tooltip>,
    );

    const wrapper = screen.getByRole('button', { name: 'Bottom' }).parentElement!;
    fireEvent.mouseEnter(wrapper);
    act(() => { vi.advanceTimersByTime(0); });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});
