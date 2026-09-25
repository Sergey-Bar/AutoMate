# Automate CLI

CLI setup wizard for Automate Playwright dashboard.

## Installation

```bash
npx Automate init
```

## What it does

- Detects your Playwright config file in the current project
- Prompts for Automate server URL and reporter port
- Optionally installs `@automate/reporter` with your package manager
- Optionally updates Playwright reporter config and prints CI env setup instructions

## Manual setup alternative

If you prefer not to use the wizard:

1. Install the reporter manually:
   - `pnpm add -D @automate/reporter`
   - or `npm install -D @automate/reporter`
   - or `yarn add -D @automate/reporter`
2. Add reporter config in `playwright.config.ts`/`.js`:

```ts
reporter: [
  ['list'],
  ['@automate/reporter', { port: 4001 }]
]
```

3. Set `Automate_DASHBOARD_URL` in CI, for example: `Automate_DASHBOARD_URL=http://localhost:4001`
