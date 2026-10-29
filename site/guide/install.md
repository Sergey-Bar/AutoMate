# Install

Automate runs as a set of containers on one machine. A release is one zip with everything
needed to start it; the images are downloaded the first time.

## What you need

- **Docker** with Compose v2: [Docker Desktop](https://docs.docker.com/get-docker/) on
  Windows or macOS, or Docker Engine with the Compose plugin on Linux.
- About 5 GB of disk for the images. The test runner image is most of it, because it
  carries Chromium, Firefox and WebKit.
- amd64 or arm64 (Apple Silicon included). The images are published for both.

## Install and start

1. Download `automate-<version>.zip` from the
   [latest release](https://github.com/Sergey-Bar/AutoMate/releases/latest). The release
   also has `SHA256SUMS`, if you want to check the download.
2. Unzip it anywhere. Everything lives in the `automate-<version>` folder.
3. Start Docker, then run the start script from that folder:

   | System            | Command                                                      |
   | ----------------- | ------------------------------------------------------------ |
   | Windows           | double-click `start.cmd`, or run `.\start.cmd` in a terminal |
   | macOS, Linux, WSL | `./start.sh`                                                 |

The first run:

- creates `.env` with new random secrets;
- downloads the images, which takes a few minutes;
- starts the stack and waits until it is ready;
- opens `http://localhost:8080` and prints the installation key (also saved in `.env`
  as `AUTOMATE_INSTALLATION_KEY`).

Running it again just starts what is already there.

### What should I see next?

On the default **solo** profile, the console opens for the operator on this machine.
You do not need to sign in. The script also prints an installation key; keep it with
the installation's configuration.

For other people to use the same installation, first [choose a shared profile](profiles.md).
That guide explains the network and sign-in setup for a small team or an organisation.

### What should I do first?

1. [Explore a run](concepts.md) to learn where results and evidence appear.
2. [Send a report](sending-results.md) from your existing test suite.
3. [Read the quality gate](quality-gates.md) to understand what the evidence says about readiness.

## Everyday commands

The same on both scripts: `start.cmd <command>` on Windows, `./start.sh <command>`
elsewhere.

| Command                  | What it does                                                      |
| ------------------------ | ----------------------------------------------------------------- |
| _(none)_                 | Start, or start again                                             |
| `stop`                   | Stop the containers. Data is kept                                 |
| `status`                 | Show the containers and their health                              |
| `logs`                   | Follow the logs                                                   |
| `update`                 | Move to the latest release. Data is kept; migrations run on start |
| `update --version X.Y.Z` | Move to a particular release                                      |
| `uninstall`              | Remove the containers. Data and `.env` are kept                   |
| `uninstall --purge`      | Remove everything, including all data and `.env`                  |

## Settings

Set these in `.env` (or in your shell) and start again.

| Setting               | Default                   | Meaning                               |
| --------------------- | ------------------------- | ------------------------------------- |
| `AUTOMATE_PORT`       | `8080`                    | The one port Automate publishes       |
| `AUTOMATE_BIND`       | `127.0.0.1`               | The address it listens on             |
| `AUTOMATE_PUBLIC_URL` | `http://localhost:<port>` | The URL users open, if it is not that |

::: warning Opening it to your network
With the default `AUTOMATE_BIND=127.0.0.1`, only this machine can reach Automate.
The solo profile refuses settings that make it reachable from another machine.
To share it, choose the appropriate [profile](profiles.md), then follow
[LAN mode](lan-mode.md) or [remote access](remote-cloudflare.md). Changing the bind
address alone is not a complete shared installation setup.
:::

## Keep `.env`

`.env` holds the secrets that sign sessions and encrypt stored connector credentials. The
start scripts never overwrite it. If you lose it, the data may still be in Docker's volumes
but the installation cannot read credentials encrypted with the missing key. Restore the
original `.env` from your backup. A fresh installation does not recover those credentials.

## Troubleshooting

| You see                                | Do this                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| `Docker is not installed`              | Install Docker Desktop (or Docker Engine) and run start again         |
| `Docker is not running`                | Start Docker Desktop and wait until it says it is running             |
| `Docker Compose v2 is required`        | Update Docker Desktop, or install the `docker-compose-plugin` package |
| `did not become ready`                 | Run `logs` and look for the service that keeps restarting             |
| `port is already allocated`            | Set `AUTOMATE_PORT` to a free port in `.env`                          |
| Windows: `running scripts is disabled` | Use `start.cmd`, not `start.ps1`                                      |
| `denied` while pulling                 | That release's images are not public yet; try the previous release    |

## What is inside

The zip's `compose.yml` is generated from `infra/compose/docker-compose.unified.yml` with
every service pointing at its published image, `ghcr.io/sergey-bar/automate-<service>`.
It runs PostgreSQL, an S3-compatible object store (SeaweedFS), the migrations, the API,
the worker, the Playwright runner, the web UI and an edge proxy. Only the proxy publishes
a port. How a release is built is described in
[ADR-013](https://github.com/Sergey-Bar/AutoMate/blob/main/docs/adr/013-published-images-and-a-release-bundle.md).
