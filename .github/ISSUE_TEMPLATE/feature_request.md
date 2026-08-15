---
name: Feature request
about: Suggest a capability or an additional reading
labels: enhancement
---

## What you want

## Does the hardware actually report it?

The dashboard only shows values the device reports. Before requesting a new
reading, it helps to confirm the hardware exposes it at all:

```sh
curl -s -b /tmp/c "http://<stick-ip>/status_pon.asp"
```

On the HSGQ stick only port 80 is open — telnet, SSH and HTTPS are all closed
despite the datasheet listing them — and no page exposes SFF-8472 threshold
bytes, so the module's own alarm limits are not reachable.

If the device does not report it, it cannot be displayed, and a plausible-looking
placeholder is worse than an honest omission.

## Why it matters

<!-- What decision or diagnosis this would let you make. -->
