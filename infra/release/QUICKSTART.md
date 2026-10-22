# Automate {{VERSION}} — quick start

You need **Docker** and nothing else: [Docker Desktop](https://docs.docker.com/get-docker/)
on Windows or macOS, or Docker Engine with the Compose plugin on Linux.

1. **Start Docker.**
2. **Unzip** this folder anywhere.
3. **Run start:**
   - Windows: double-click `start.cmd`.
   - macOS / Linux: run `./start.sh` in a terminal, in this folder.

The first start downloads the images, which takes a few minutes. When it is done, your
browser opens **http://localhost:8080** and the terminal prints the key to sign in with.
It is also saved in `.env` as `AUTOMATE_INSTALLATION_KEY`.

## Everyday commands

Use `start.cmd <command>` on Windows and `./start.sh <command>` elsewhere.

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| _(none)_            | Start Automate, or start it again                    |
| `stop`              | Stop it. Your data is kept                           |
| `status`            | Show what is running                                 |
| `logs`              | Follow the logs (Ctrl+C to stop following)           |
| `update`            | Move to the latest release. Your data is kept        |
| `uninstall`         | Remove the containers. Your data and `.env` are kept |
| `uninstall --purge` | Remove everything, including all data                |

## Good to know

- **Keep `.env`.** It holds the secrets that sign you in and encrypt stored credentials.
  Creating new ones would lock you out of your own data.
- **It is only reachable from this machine.** Automate has no login in front of it, so it
  listens on `127.0.0.1` by default. Setting `AUTOMATE_BIND=0.0.0.0` makes it reachable by
  anyone on your network — do that only on a network you trust.
- **Port 8080 taken?** Set `AUTOMATE_PORT=8090` (or any free port) in `.env` and start again.

Full documentation: https://sergey-bar.github.io/AutoMate/
