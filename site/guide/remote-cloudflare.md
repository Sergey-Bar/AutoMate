# Reach it from anywhere (Cloudflare)

Cloudflare Tunnel connects your Automate install to Cloudflare without opening a port on
your router or firewall. Cloudflare Access sits in front of it and decides who may reach
it: your Google, GitHub, Microsoft or Okta sign-in, a one-time code by email, or a
service token for CI. Automate then checks every request Access lets through, so a
request that only _claims_ to come from Cloudflare is refused.

This needs the `startup` profile or larger. A `solo` install stays on its machine and
refuses a tunnel.

## What you need

- A Cloudflare account with Zero Trust turned on. The free plan is enough for a small team.
- A domain whose DNS is on Cloudflare, for the hostname people will open, such as
  `automate.example.com`.
- An install started at least once, so `.env` exists.

## Set it up

1. **Create the tunnel.** In the Zero Trust dashboard, open _Networks → Tunnels_, create a
   tunnel of type _Cloudflared_, and copy its token. Skip the install command it shows:
   the `cloudflared` container in the Automate stack runs the tunnel for you.
2. **Give it a public hostname.** On the tunnel's _Public hostname_ tab, add
   `automate.example.com` with service type `HTTP` and URL `edge:8080`. That is the
   stack's front door on the compose network; nothing on your machine is published.
3. **Put Access in front of it.** Open _Access → Applications_, add a _Self-hosted_
   application for the same hostname, and add a policy that allows your team, such as
   _Emails ending in_ `@example.com`. On the application's overview, copy the
   _Application Audience (AUD) tag_.
4. **Start Automate with the tunnel.**

   ```sh
   export TUNNEL_TOKEN='paste-the-tunnel-token'
   export CF_ACCESS_TEAM_DOMAIN='your-team'          # or your-team.cloudflareaccess.com
   export CF_ACCESS_AUD='paste-the-audience-tag'
   export AUTOMATE_PUBLIC_URL='https://automate.example.com'
   ./start.sh --profile startup --remote cloudflare
   ```

   ```powershell
   $env:TUNNEL_TOKEN = 'paste-the-tunnel-token'
   $env:CF_ACCESS_TEAM_DOMAIN = 'your-team'
   $env:CF_ACCESS_AUD = 'paste-the-audience-tag'
   $env:AUTOMATE_PUBLIC_URL = 'https://automate.example.com'
   .\start.cmd --profile startup --remote cloudflare
   ```

   The start script keeps the three tunnel values in `.env`, so a plain `./start.sh` later
   still starts the tunnel. It never prints the token. Put `AUTOMATE_PUBLIC_URL` in `.env`
   too: links in reports and the cross-site check use it.

5. Open `https://automate.example.com`. Cloudflare asks you to sign in; Automate then
   opens with the role your identity maps to.

## Who gets which role

Access decides who reaches the install. `CF_ACCESS_ROLE_MAP` decides what each of them may
do once inside. Each rule is `role:who`, separated by commas, and an identity gets the
highest role any rule gives it:

```sh
CF_ACCESS_ROLE_MAP='admin:ana@example.com,operator:*@example.com,operator:group:qa,viewer:service:ci-token.access'
```

| Rule                     | Matches                                                                      |
| ------------------------ | ---------------------------------------------------------------------------- |
| `admin:ana@example.com`  | one person, by email, in any letter case                                     |
| `operator:*@example.com` | everyone at that email domain (not its subdomains)                           |
| `operator:group:qa`      | a group, when your identity provider forwards groups as a claim to the token |
| `viewer:service:<id>`    | an Access service token, by its client id                                    |

Anyone Access lets in that no rule names gets `CF_ACCESS_DEFAULT_ROLE`, which is `viewer`
unless you set it. Set `CF_ACCESS_DEFAULT_ROLE=none` to admit only the people the map names;
everyone else is refused with _forbidden_ rather than asked to sign in again.

Access tokens and paired devices keep working beside Access, and a token presented with a
request wins over the Cloudflare identity on it.

## On team and enterprise, people are accounts

On the `startup` profile the role map is the whole story: an identity's role is what the map
says, every request. From `team` up, a person Access lets in becomes an Automate account the
first time they arrive, just as an OIDC sign-in makes one. That gives you three things:

- **They appear on _Map → Members_**, where an admin changes their role, disables them or
  adds them to another workspace. Their role in each workspace is their membership there.
- **The role map still decides the default workspace.** A person a rule names gets that
  rule's role there on every request, so a change in your identity provider takes effect
  straight away. Anyone else gets `CF_ACCESS_DEFAULT_ROLE` the first time, and keeps what an
  admin gives them after that. Every other workspace is membership only.
- **SCIM reaches them.** A person your identity provider provisions is linked by email on
  their first visit and keeps the provisioned role. Deactivate them in the provider and
  Automate refuses their next request, without waiting for their Access session to end. Set
  `CF_ACCESS_DEFAULT_ROLE=none` to admit only the people SCIM or the map names.

A person is the Access team and its user id, never the email alone. So a person who already
signed in through OIDC with the same email is refused through Access rather than merged with
that account: use one of the two for people. A service token stays a machine on every
profile, with the role map's role in every workspace.

## CI through the tunnel

Create a service token under _Access → Service auth_, add a _Service Auth_ policy for it to
the application, and give the CLI both halves beside its access token:

```sh
export AUTOMATE_URL='https://automate.example.com'
export AUTOMATE_TOKEN='amt_...'                       # an uploader token from the Access page
export AUTOMATE_CF_ACCESS_CLIENT_ID='...access'
export AUTOMATE_CF_ACCESS_CLIENT_SECRET='...'
automate upload --format sarif --file semgrep.sarif
```

The service token gets the request through Cloudflare; the access token still decides what
it may do.

## GitHub webhooks

GitHub cannot sign in to Access. If you use the [webhook receiver](/guide/delivery-performance),
add a second Access application for the path `automate.example.com/api/v1/webhooks/github`
with a _Bypass_ policy. The receiver checks GitHub's HMAC signature on every delivery, and
answers only with `GITHUB_WEBHOOK_SECRET` set on an install that is reachable: LAN mode, or
this tunnel.

## What Automate checks, and what it refuses

- **Every request is verified.** The `Cf-Access-Jwt-Assertion` header must be signed with
  `RS256` by a key your team publishes, name your team as issuer and this application's
  audience tag, and be unexpired. Anything else carries no Cloudflare identity at all. The
  team's keys are cached and fetched again when Cloudflare rotates them.
- **A tunnel needs a login.** `AUTOMATE_REMOTE=cloudflare` with `ACCESS_CONTROL=open`, or
  without both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`, refuses to start. So does a
  tunnel on the `solo` profile.
- **A LAN certificate and a tunnel do not mix on one port.** With `lan-cert` issued, the edge
  redirects plain HTTP to HTTPS. Point the tunnel at `https://edge:8443` with _No TLS Verify_
  instead, or skip the LAN certificate.

## What has and has not been tested

The verifier, the role map, the people it signs in, the startup refusals and the start
scripts are tested against keys generated at test time, the real migration graph and a
stand-in for Docker. No run against a real Cloudflare account is recorded yet, and the
[capability register](/pages/capabilities) says so.
