# UI Component Design Map

This document tracks the canonical source decisions for extracting shared UI primitives into the `@automate/ui` package.

| Component | Canonical Source | Rationale & Considerations |
| :--- | :--- | :--- |
| **Button** | Automate | Automate's implementation uses more generic theme tokens (`bg-primary`, `bg-error`) compared to Dashboard's state-specific ones (`bg-running`, `bg-fail`). It handles i18n/RTL well. Added `link` variant to match unified specs. |
| **Input** | Automate | TBD. Automate likely has better forwardRef and accessibility integration. |
| **Select** | Automate | TBD. Automate likely has more comprehensive Radix/Headless integration. |
| **Toggle** | Dashboard | TBD. Dashboard switches for feature flags handle states elegantly. |
| **Kbd** | Automate | TBD. Typically simple, Automate has well-defined typography tokens. |
| **Tooltip** | Dashboard | TBD. Dashboard likely has more sophisticated boundary handling for complex data views. |
| **EmptyState** | Automate | Automate's pattern with named Framer Motion illustrations (`Radar`, `Inbox`, etc.) is robust and engaging. |
| **Skeleton** | Automate | Automate's simple animation pattern aligns with the unified design language. |
| **ErrorBoundary** | Dashboard | Dashboard has comprehensive error tracking/recovery logic suited for the platform. |

## Notes
- Ensure all components support standard `React.forwardRef` to allow composition.
- Retain `data-testid` support for Playwright E2E tests in both consuming apps.
- Respect Dashboard i18n/RTL requirements by avoiding hardcoded physical direction margins (`ml-2`) where logical properties (`ms-2`) are more appropriate.
