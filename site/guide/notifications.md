# Scheduled reports

A short report — daily, weekly, or on your own schedule — to Slack, Microsoft Teams,
Telegram, WhatsApp, Signal, or Automate's own inbox. Open **Map → Reports**.

## What a report looks like

The same five-second shape on every platform, and the same shape as the **Now** page:

```
🔴 Weekly quality report
92.4% passed across 118 runs.
🔴 checkout e2e failed 3 times
🔴 2 new flaky tests
🟡 Coverage −1.2 pts
+2 more
https://automate.local:8443/dashboard/now
```

A status you can see before you read, one sentence, at most three items worst first,
how many more there are, and one link. A missed schedule — the server was off for a
week — sends one catch-up report, never a backlog.

## Set it up in three steps

1. **Where.** Add a channel. Start with **Automate inbox**: it needs no account, and its
   reports appear in the history on the same page.
2. **When.** Pick **Daily 09:00**, **Weekly, Monday 09:00**, or **Custom** (a cron
   expression such as `0 8 * * 1-5` for weekdays at 08:00). The timezone defaults to your
   browser's.
3. **Did it arrive.** **Send a test** on any channel; the result appears in the history
   and as a toast. A failed delivery shows the platform's error code, for example
   `telegram_rejected_401` for a wrong bot token.

Adding or removing a channel needs the **admin** role (a channel holds a credential);
scheduling needs **operator**; everyone can read the history. Credentials are encrypted
in the vault (`VAULT_SECRET` must be set) and never shown again.

## Each platform, in five steps or fewer

### Slack

1. At api.slack.com/apps, **Create New App → From scratch**.
2. **OAuth & Permissions → Bot Token Scopes**: add `chat:write`.
3. **Install to Workspace** and copy the **Bot User OAuth Token** (`xoxb-…`).
4. In the Slack channel, `/invite @your-app`.
5. In Automate: Slack, channel `#your-channel`, paste the token.

### Microsoft Teams

1. In the Teams channel, **⋯ → Workflows**.
2. Choose **Post to a channel when a webhook request is received**.
3. Finish the wizard and copy the URL it shows.
4. In Automate: Microsoft Teams, paste the URL.

Office 365 "Incoming Webhook" connectors are retired by Microsoft; Workflows is the
replacement. The URL is the credential — keep it like a password.

### Telegram

1. Message **@BotFather**, send `/newbot`, and copy the token.
2. Add the bot to your group (or message it directly).
3. Send any message in that chat, then open
   `https://api.telegram.org/bot<token>/getUpdates` and copy `chat.id` (groups start with `-100`).
4. In Automate: Telegram, chat id, paste the token.

### WhatsApp

WhatsApp only lets a business start a conversation with an **approved template**, so this
one takes Meta's review (usually under a day).

1. Create a Meta Business account and a WhatsApp Cloud API app at developers.facebook.com.
2. Note the **Phone number ID** and create a **system-user access token**.
3. In WhatsApp Manager, create a template (category _Utility_) whose body is `{{1}}`.
4. Wait for approval.
5. In Automate: WhatsApp, phone number id, recipient (digits, country code first),
   template name and language, paste the token.

### Signal

Signal has no official bot API. Automate uses the self-hosted
[`signal-cli-rest-api`](https://github.com/bbernhard/signal-cli-rest-api) bridge, shipped
as an optional service in the compose file.

1. `docker compose --profile signal up -d signal`
2. Link it to a Signal account once: open `http://localhost:8080/v1/qrcodelink?device_name=automate`
   on the server (publish the port temporarily, or use `docker compose exec`) and scan it
   from Signal → **Settings → Linked devices**.
3. In Automate: Signal, the account's number (`+15551234567`), the recipients
   (comma-separated numbers or group ids), and bridge URL `http://signal:8080`.

The bridge is reached only from inside the compose network; it is never published.

## How it works

Saving a schedule writes a `schedules` row the worker fires. The worker — which has the
clock but not the vault — queues one `report_deliveries` row per occurrence; the key is
unique, so two workers queue it once. The API's dispatcher claims queued rows with
`FOR UPDATE SKIP LOCKED`, opens the channel's credential, renders for the platform and
sends. A rate limit is retried with backoff up to three attempts; anything else fails
visibly with the platform's code. `REPORT_DISPATCH_INTERVAL_MS` (default 15000) is how
often the dispatcher looks.
