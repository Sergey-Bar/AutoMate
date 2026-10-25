# Serve your network (LAN mode)

One machine runs Automate. Every other laptop, phone and tablet on the same Wi-Fi or
wired network opens it in a browser, signs in or pairs, and uses it. Linux and Windows
(Docker Desktop) are both supported servers.

## The short version

```sh
# On the server, in the folder you unpacked the release into:
AUTOMATE_LAN_MODE=1 AUTOMATE_BIND=0.0.0.0 ./start.sh lan-cert   # once
AUTOMATE_LAN_MODE=1 AUTOMATE_BIND=0.0.0.0 ./start.sh
```

```powershell
# Windows:
$env:AUTOMATE_LAN_MODE = '1'; $env:AUTOMATE_BIND = '0.0.0.0'
.\start.cmd lan-cert   # once
.\start.cmd
```

Put both settings in `.env` instead of the shell to make them stick. Then, on another
device, open `https://<server-name>.local:8443` or `https://<server-ip>:8443`.

## What LAN mode turns on

| Protection             | What it does                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in on every route | `ACCESS_CONTROL` becomes `enforced`. Only the health probes and the sign-in and pairing exchanges answer without a credential.                                    |
| A refusal, not a hint  | Binding beyond this machine without LAN mode refuses to start, at the prompt and again in the API. LAN mode with `ACCESS_CONTROL=open` also refuses.              |
| A client allowlist     | Only private, loopback and link-local addresses are let in. Set `ALLOWED_CLIENT_CIDRS` (comma-separated, for example `192.168.1.0/24`) to narrow it.              |
| Cross-site protection  | A state-changing request a browser sends on behalf of another page is refused with `CROSS_SITE_REQUEST`.                                                          |
| HTTPS                  | Once `lan-cert` has run, the edge serves HTTPS on `AUTOMATE_HTTPS_PORT` (default 8443), redirects plain HTTP to it, sends HSTS, and session cookies are `Secure`. |

If you narrow `ALLOWED_CLIENT_CIDRS`, keep `172.16.0.0/12` in it: the bundled runner reaches
the API from the Docker network, and Docker Desktop delivers browser connections from its
own gateway in that range.

## Signing devices in

- **Pair a device (easiest).** On the server's browser, open **Map → Access**, type a device
  name, pick viewer or operator, and press **Get a code**. Scan the QR code with the phone,
  or open `/dashboard/pair` on the device and type the six digits. A code works once, for
  ten minutes, and never mints an admin. Paired devices appear in the token list, named
  `device: <name>`, and **Revoke** signs that device out for good.
- **Sign in with a key.** The installation key in `.env` (`AUTOMATE_INSTALLATION_KEY`) signs
  in as admin. Keep it for the server's own browser.
- **Issue a token.** The same Access page issues viewer, operator, admin or CI uploader
  tokens for people and pipelines.

## Trust the certificate once per device

`start lan-cert` creates a small certificate authority for your network in `certs/` and a
server certificate for every name and address the machine answers to (`<hostname>`,
`<hostname>.local`, `automate.local`, `localhost`, and its LAN addresses). Add more with
`AUTOMATE_TLS_NAMES`. Each device trusts `certs/ca.crt` once; reissuing the server
certificate later (a new IP) keeps the same CA, so no device has to trust it again. Only
`AUTOMATE_NEW_CA=1` replaces the CA.

Copy `certs/ca.crt` to the device (a USB stick, a file share, or an email to yourself), then:

| Device  | How                                                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | Double-click `ca.crt` → **Install Certificate** → **Local Machine** → **Trusted Root Certification Authorities**.                                           |
| macOS   | Double-click `ca.crt` (Keychain Access opens) → find "Automate local CA" → **Get Info** → **Trust** → **Always Trust**.                                     |
| Linux   | `sudo cp ca.crt /usr/local/share/ca-certificates/automate.crt && sudo update-ca-certificates`. Firefox has its own store: Settings → Certificates → Import. |
| iPhone  | AirDrop or mail `ca.crt` → Settings → **Profile Downloaded** → Install, then Settings → General → About → **Certificate Trust Settings** → turn it on.      |
| Android | Settings → Security → **Encryption & credentials** → **Install a certificate** → **CA certificate** → pick `ca.crt`.                                        |

## The firewall

The start scripts print the command; they never change your firewall.

- **Windows:** in an elevated PowerShell,
  `New-NetFirewallRule -DisplayName 'Automate' -Direction Inbound -Protocol TCP -LocalPort 8443 -Action Allow -Profile Private`
  (and once more for 8080 if you want the plain-HTTP redirect). Docker Desktop must be
  allowed on **Private** networks; mark your Wi-Fi as Private, not Public.
- **Linux (ufw):** `sudo ufw allow 8443/tcp`. **firewalld:**
  `sudo firewall-cmd --add-port=8443/tcp --permanent && sudo firewall-cmd --reload`.

## Finding the server by name

Windows, macOS and most Linux desktops already answer to `<hostname>.local` on the local
network, and the certificate covers that name. `automate.local` is also in the certificate,
for a network whose router can map that name to the server; Automate does not run its own
name responder, because Docker Desktop cannot pass multicast from its VM to your network.
The address the server's own browser uses is always shown on the Access page.

## Remote runners

Another machine can run jobs for this server. The Access page's **Connect a runner** panel
shows the settings: `AUTOMATE_API_URL` (this server's `https://` address),
`RUNNER_REGISTRATION_SECRET` (from the server's `.env`) and a new `RUNNER_INSTANCE_ID`.
Artifacts upload over HTTPS, so a runner needs no shared disk with the server.

The runner refuses a plain-HTTP `AUTOMATE_API_URL` that points at another machine, because
its registration secret and job tokens would cross the network in the clear. Issue the LAN
certificate first, or set `RUNNER_ALLOW_INSECURE_API=1` on a network you trust completely.
Add the URLs the runner may test to `RUNNER_ALLOWED_TARGET_URLS`.
