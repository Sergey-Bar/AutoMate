# UI Component Design Map

This document records where each shared primitive came from, and — the part that
matters — which of them still exist.

## The two rows that were not true

**`Kbd` and `ErrorBoundary` were listed here and neither has ever existed in
`packages/ui/src`.** There are no `Kbd` or `ErrorBoundary` directories, no exports,
no tests, and nothing imports either name. A design map that lists a component the
package does not ship is a document making a claim no command checks: the next
reader either goes looking for a `Kbd` that is not there, or builds one because the
map says the decision was made. Both cost more than the row saved.

They are gone from the table rather than marked "planned", because "planned" is
what made them look real in the first place. `ErrorBoundary` is still worth having
and is tracked as a piece of work in the roadmap's Track A (item A3); a row in this
table would have been the second place that decision is recorded, and the first one
nothing reads.

`packages/ui/src` is the authority for what this package exports. `src/index.ts` is
the list.

## Components

| Component      | Canonical Source | Rationale & Considerations                                                                                                                                                                                                                           |
| :------------- | :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Button**     | Automate         | Automate's implementation uses more generic theme tokens (`bg-accent`, `bg-danger`) compared to Dashboard's state-specific ones (`bg-running`, `bg-fail`). It handles i18n/RTL well. Added `link` variant to match unified specs.                    |
| **Input**      | Automate         | `forwardRef` throughout, and the label/error association is wired in the component rather than left to the caller.                                                                                                                                   |
| **Select**     | Automate         | Native `<select>` with the option set this product needs.                                                                                                                                                                                            |
| **Toggle**     | Dashboard        | Switches for feature flags handled states elegantly.                                                                                                                                                                                                 |
| **Tooltip**    | Dashboard        | More sophisticated boundary handling for complex data views.                                                                                                                                                                                         |
| **EmptyState** | Automate         | `icon` is a `ReactNode` and `action` is a `ReactNode`, so a caller can put a link, a button or a row of buttons there rather than the `{ label, onClick }` pair the removed application copy hard-coded.                                             |
| **Skeleton**   | Automate         | Three variants, each carrying its own dimensions. The `block` variant used to be `rounded-md` alone, which made the _default_ a 0-height element.                                                                                                    |
| **Alert**      | Automate         | This is the error state. There is no `ErrorState` component, and adding one would have recreated the second family that `apps/web/src/components/shared/` used to carry. `role="alert"` is on the component, not on each call site.                  |
| **Icon**       | Automate         | A named re-export of `lucide-react`, not `export *`. The dependency lives in this package, and an application component cannot import it — pnpm's isolated `node_modules` is why. The list is a decision: adding an icon is a line a reviewer reads. |

## Notes

- Ensure all components support standard `React.forwardRef` to allow composition.
- Retain `data-testid` support for Playwright E2E tests in both consuming apps.
- Respect Dashboard i18n/RTL requirements by avoiding hardcoded physical direction margins (`ml-2`) where logical properties (`ms-2`) are more appropriate.
- Every colour is a token from `src/tokens/theme.css`. A literal hex in a component is a defect, and `apps/web/src/theme-resolution.test.ts` fails the build on one — including in this package, whose sources it scans alongside the application's.
