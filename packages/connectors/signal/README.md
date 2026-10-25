# @automate/connectors-signal

A self-hosted signal-cli-rest-api bridge: about and send for scheduled reports.

The adapter implements `ConnectorAdapter` from `@automate/connectors-sdk`: a dispatch table beside its manifest, the SDK's retry policy, and failures reported through `connectorFailure`. The secret is passed per call and never stored here. Setup steps are in `site/guide/notifications.md`.
