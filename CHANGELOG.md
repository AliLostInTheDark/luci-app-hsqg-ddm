# Changelog

## 1.0.0-r1

Correctness pass over the whole package. Several of these were producing wrong
readings on working hardware rather than merely being untidy.

### Fixed — wrong values

- **Registration status was reported backwards.** The row renders as
  `Registered Status | Registered Status | Not Registered`, and the parser matched
  the first `Registered` in the line — which is part of the *label*. A module
  reporting **Not Registered** displayed as **Registered**. Alternation order
  cannot fix this, because `match()` returns the leftmost hit; the label is now
  stripped before the value is read. The ONU state of `O1` had been corroborating
  *Not Registered* all along.

- **The optical module's own identity was never shown.** `Vendor Name: ODI` and
  `Part Number: DFP-34X-2C2` sit inside an HTML comment on `status_pon.asp`, so
  they rendered but were never parsed. The dashboard displayed the OMCI *emulated*
  identity in their place, which describes the ONU the stick pretends to be, not
  the optic fitted to it. Both are now reported, separately.

- **Unread values were emitted as sentinels that graded as alarms.** Temperature
  defaulted to `-100.0` and voltage to `0.0`, so a failed scrape rendered as a red
  cryogenic alarm and a voltage fault on healthy hardware. Every value is now JSON
  `null` when it was not read, and renders as `--`.

- **A transmitter reported as off displayed as "Unknown".** The module reports
  `-inf dBm` when the laser is off. That is a definite state the device told us,
  not an absence of information, and it now reads **Laser Off**.

- **The receiver "usable window" showed the warning band.** It rendered
  `-26.0 … -9.0 dBm` — the warning limits — while the transmit row showed its
  alarm limits, so the two cards used different meanings under similar labels. The
  usable receiver window is by definition sensitivity to overload, the Loss of
  Signal assert points, and now reads `-27.0 … -8.0 dBm`.

- **The optical class was asserted as fact.** The HSGQ datasheet states compliance
  with ITU-T G.984.2 and Amendment 1 but publishes no power budget class and no
  sensitivity or launch figures, and the module reports none. The class is now
  labelled *(assumed - not reported by module)* unless the optic names one in its
  vendor or part string, in which case that wins.

- **The connector was asserted without evidence.** It read `SC-APC`; the datasheet
  states only `type: SC`, the module reports no connector field, and the stick
  ships in both variants. It now reads `Single-core, single-mode (SC)`.

### Fixed — failures disguised as data

- **The `wget` fallback was non-functional and reported a misleading cause.** It
  discarded the login response and never saved or replayed a cookie jar, so every
  subsequent fetch was unauthenticated and the user was told the host had timed
  out when authentication had silently never happened. BusyBox `wget` and
  `uclient-fetch` have no cookie support, so the branch could not be repaired
  portably; `curl` is a declared dependency and its absence is now stated plainly.

- **An unreachable module left the last good reading on screen indefinitely.** The
  dashboard bailed out early on an error response and simply did not update.
  Errors now surface, and cache replay is bounded.

### Fixed — parsing robustness

- **Label lookahead never gave up.** A missing value line left the "expecting a
  value" flag set, so the next line anywhere below containing any number was
  captured as that field. The lookahead is now bounded.
- The LAN counter split relied on leading whitespace producing an empty first
  field, and `omcc_ver` matched the first number anywhere on its line, including
  inside markup.
- Device-derived strings are escaped before interpolation into JSON. One stray
  quote previously produced invalid JSON, failing the RPC call and freezing the
  dashboard on stale data.

### Added

- **Instant page load.** A cached reading is served immediately and refreshed
  behind the response: roughly 1.3 s down to 30 ms on a warm cache. Staleness is
  capped at 30 seconds — beyond that the caller waits for a real answer, because
  replaying older data would render a module that died minutes ago as healthy.

- **`proto` and `port` are now honoured.** Both were exposed in the settings UI
  and stored in `/etc/config/hsqg_ddm`, but the backend hardcoded
  `http://<host>/…` and read neither, so changing them did nothing. HTTPS is
  supported for the module's own self-signed interface. The protocol list no
  longer offers Telnet or SSH, which were never reachable code paths.

- **Thresholds now flow from the backend to the UI.** The backend already emitted
  twenty threshold values that the dashboard ignored while hardcoding different
  ones, so the table could advertise a limit the badge disagreed with. Both now
  derive from one payload.

- **Loss of Signal is asserted on both sides of the receiver window** — below
  sensitivity and above overload — since a saturated receiver loses framing just
  as thoroughly as a dark one.

- Settings survive sysupgrade via `/lib/upgrade/keep.d`, alongside the existing
  `conffiles` handling for package upgrade. The uci-defaults script is additive
  and idempotent, so new options are seeded on upgrade without overwriting values
  already set.

### Security

- The login password is no longer passed on the `curl` command line, where any
  local user could read it from `ps`. It is fed on stdin.
- The cookie jar and cache in `/tmp` are created `0600`.

### Changed — card layout

- Four cards with no overlapping subject matter: OMCI management, BOSA laser and
  optics, Ethernet and packet statistics, and system information. The OMCI card
  now carries the six managed-entity attributes that were scraped and discarded —
  ONU identifier, OMCI vendor, both software images, OUI and MAC key status.

### Interface

- Layout no longer truncates on phones: fixed row heights that clipped wrapped
  text are gone, and the threshold matrix scrolls horizontally inside its own
  container instead of forcing the page sideways.
- The temperature card shows the datasheet operating rating for reference. It is
  deliberately not used for grading: the DDM reading is the transceiver's internal
  temperature, which normally sits above ambient, so grading it against an ambient
  rating would raise alarms that mean nothing. Alarm bands stay on SFF-8472.
