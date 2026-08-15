# Contributing

## The one rule

**Never show a value the hardware did not report.**

A parse miss, an unreachable device or a timeout must surface as `--`/unknown, or
as an error banner. It must never appear as a plausible-looking reading, and it
must never appear as a fake alarm. Both of those have shipped here before:

- the backend emitted `-100.0` for an unread temperature, which the dashboard
  then graded as a red cryogenic alarm — a scrape failure displayed as a hardware
  fault;
- the "Registered Status" row was read by matching the first `Registered` in the
  line, which is part of the *label*, so a module reporting **Not Registered**
  displayed as **Registered**;
- the module identity `ODI / DFP-34X-2C2` sits inside an HTML comment and was
  never parsed, while the OMCI emulated identity was shown in its place.

If you cannot determine something, say so in the UI. `(assumed - not reported by
optic)` is a good outcome. A confident wrong number is not.

## Checks before you open a pull request

Every layer here is a different language, and each has been broken at least once
by an edit that "obviously" could not break anything. Run all of them:

```sh
# Shell - the router runs BusyBox ash, so dash matters more than bash
for f in deploy.sh root/usr/libexec/rpcd/hsqg_ddm root/etc/uci-defaults/*; do
  sh -n "$f" && bash -n "$f" && dash -n "$f"
done

# LuCI views - top-level `return`, so wrap before parsing
for f in htdocs/luci-static/resources/view/hsqg_ddm/*.js; do
  node -e "new Function('return (function(){'+require('fs').readFileSync('$f','utf8')+'})')"
done

# ACL and menu
for f in root/usr/share/rpcd/acl.d/*.json root/usr/share/luci/menu.d/*.json; do
  python3 -m json.tool "$f" >/dev/null
done
```

CI runs the same set. Two traps worth knowing:

- **Apostrophes inside the embedded `awk` program.** The program lives inside a
  single-quoted shell string, so one apostrophe in a comment ends it and the
  whole script breaks somewhere else entirely. Write "the module identity",
  never "the module's identity".
- **BusyBox `awk` is much stricter than gawk**: no `gensub`, no `length(array)`,
  no `asort`. Parse under `awk`, `mawk` and `busybox awk` before pushing.
- **Matching a value that repeats its own label.** Prefer stripping the label
  first; `match()` returns the leftmost hit, so alternation order will not save
  you.
- **`flock -w`.** util-linux supports it; BusyBox does not, and errors out. Detect
  the capability, and treat a failure to lock as "carry on", never as a device
  error.

## Testing against hardware

There is no substitute. Deploy with `./deploy.sh <router-ip>` and check:

```sh
ubus call hsqg_ddm get_status | python3 -m json.tool
```

Confirm the reading matches the ONT's own web interface or CLI. A value that
merely looks reasonable is not verified.

Note that the stick exposes **only port 80** — telnet, SSH and HTTPS are closed
despite the datasheet listing them — so the Boa web interface is the only source
of data, and the module's SFF-8472 threshold bytes are not reachable at all. The
optical class shown is therefore labelled *assumed* unless the optic names one.

## Style

- UK English in user-facing strings and comments.
- Keep user-facing strings inside `_()`.
- Match the surrounding indentation: tabs in shell and JavaScript.
- No new build steps, bundlers, frameworks or dependencies. Plain LuCI and POSIX
  shell/awk. `curl` is the one runtime dependency and is declared in the Makefile.
- Cite the governing standard where the code encodes a figure from one, and cite
  the datasheet where a vendor figure differs from the class minimum. Do not
  invent specification numbers — if you cannot verify a figure, say so rather
  than writing a plausible one.
