<div align="center">

# luci-app-hsqg-ddm
## Made with Claude Code as a personal fun project, expect bugs.

Optical diagnostics for the HSGQ XPON STICK and other Realtek RTL960x SFP ONU sticks, in OpenWrt LuCI. Telemetry is scraped from the module's own web interface and rendered live — no external libraries, no frameworks, and no compiled component.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Release](https://img.shields.io/github/v/release/AliLostInTheDark/luci-app-hsqg-ddm?label=release)](https://github.com/AliLostInTheDark/luci-app-hsqg-ddm/releases)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-any%20target-1f6feb.svg)](https://openwrt.org)

</div>

---

An SFP ONU stick is a whole ONT in a cage, and it reports far more than the four numbers a typical DDM page shows. This dashboard reads the optical power budget, the optic's own identity, the OMCI managed-entity attributes and the PON and LAN counters — and it refuses to display anything the module did not actually report.

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Supported devices](#supported-devices)
- [Dashboard cards](#dashboard-cards)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Changelog](#changelog)
- [License](#license)

## Highlights

- **Nothing is invented.** A value the module did not report shows as `--`, never as a plausible default and never as a fake alarm. Unread values used to be emitted as sentinels that graded red on healthy hardware.
- **The optic's own identity, kept separate.** `Vendor Name` and `Part Number` — `ODI / DFP-34X-2C2` on the unit this was developed against — describe the transceiver fitted to the stick, not the ONU it presents over OMCI. Both are shown, distinctly.
- **An assumed class is labelled as one.** The HSGQ datasheet cites ITU-T G.984.2 and Amendment 1 but publishes no power budget class, and the module exposes no SFF-8472 threshold bytes, so the limits shown are a stated assumption rather than a confirmed figure.
- **Laser off is not "unknown".** The module reports `-inf dBm` when the transmitter is off; that is a definite state it told us, and it reads as such.
- **Loss of Signal on both sides of the window.** Below sensitivity there is no framing; above overload the receiver is saturated and there is likewise none.
- **Instant page load.** A cached reading paints immediately and refreshes behind the response, bounded so a link that died minutes ago cannot masquerade as healthy.

## Installation

### One line, key and package together (recommended)

Installs the signing key, then fetches and installs the current release. Nothing to download by hand:

```sh
wget -qO /etc/apk/keys/luci-app-hsqg-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-hsqg-ddm/main/keys/luci-app-hsqg-ddm.pem && wget -qO /tmp/hsqg.apk "$(wget -qO- https://api.github.com/repos/AliLostInTheDark/luci-app-hsqg-ddm/releases/latest | sed -n 's/.*"browser_download_url": *"\([^"]*\.apk\)".*/\1/p' | head -1)" && apk add /tmp/hsqg.apk && rm -f /tmp/hsqg.apk
```

Run the same line again whenever you want to upgrade — the version is resolved from the Releases API each time, not baked into the URL, so it does not go stale. Each step is chained with `&&`, so a failed download can never leave you installing a truncated file.

### Manually, or from the LuCI Software page

**Install the signing key first — once per router.** Every release is signed, and with the key in place `apk` accepts the package normally: no `--allow-untrusted`, and uploading the file on LuCI's **System → Software** page just works.

```sh
wget -qO /etc/apk/keys/luci-app-hsqg-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-hsqg-ddm/main/keys/luci-app-hsqg-ddm.pem
```

Then grab the latest `.apk` from the [Releases](https://github.com/AliLostInTheDark/luci-app-hsqg-ddm/releases) page and install it — by dropping it on the Software page, or:

```sh
apk add ./luci-app-hsqg-ddm-<version>.apk
```

<details>
<summary>What that key is, and what trusting it means</summary>

`keys/luci-app-hsqg-ddm.pem` is the **public** half of the EC keypair this project's firmware build signs with; the private half never leaves the build machine. Verify it before trusting it if you like — its SHA-256 is `09069032 22035518 95a5ab10 96e7abee 6a005144 8c423fd4 8315d15f e17b0e0c`.

Installing it into `/etc/apk/keys/` tells `apk` to accept any package signed by that key, which is the same trust model every OpenWrt package feed uses. It does not grant access to anything else, and removing the file revokes it.

If you flashed a firmware image built from the same tree, you already have this key as `/etc/apk/keys/public-key.pem` and can skip this step — a second copy under a different filename is harmless, since `apk` matches on the signature rather than the filename.

Still want the old behaviour? `apk add --allow-untrusted ./luci-app-hsqg-ddm-<version>.apk` continues to work and skips verification entirely.

</details>

### From source

```sh
git clone https://github.com/AliLostInTheDark/luci-app-hsqg-ddm
cp -r luci-app-hsqg-ddm <openwrt>/package/luci-app-hsqg-ddm
make package/luci-app-hsqg-ddm/compile V=s
```

Architecture-independent. Requires `curl` at runtime, declared in the Makefile.

## Supported devices

Built for and tested against the **HSGQ XPON STICK** (GPON/EPON adaptive SFP ONU, Realtek RTL960x, Boa web interface), verified on firmware `V1.1.6-240202` with an `ODI DFP-34X-2C2` optic, under OpenWrt 25.12.

It should work with other RTL960x sticks serving the same `status_pon.asp`, `status.asp`, `gpon.asp`, `omci_info.asp`, `stats.asp` and `vlan.asp` pages.

## Dashboard cards

**Received Optical Power (RX)** — current level, the usable receiver window (sensitivity to overload, which are the Loss of Signal assert points), signal quality and wavelength.

**Transmitted Optical Power (TX)** — launch power, transmitter state and wavelength. A transmitter the module reports as off reads **Laser Off**, distinct from an unknown reading.

**Operating Temperature** — transceiver temperature, supply voltage and laser bias current. The datasheet rating is shown for reference but deliberately not used for grading: the DDM reading is the transceiver's *internal* temperature, which normally sits above ambient. The stick ships in commercial and industrial variants and does not report which is fitted, so both are shown. Alarm bands follow SFF-8472.

**OMCI Management** — activation state machine, registration, GPON serial number, ONU identifier, OLT vendor identifier, OMCI vendor identifier, OMCC version, both OMCI software images, organisationally unique identifier and MAC key status.

**BOSA Laser & Optics** — the optic's own vendor and model, optical class, wavelengths, interface connector, supply voltage, laser bias, FEC and optical alarms.

**Ethernet & Packet Statistics** — LAN interface, VLAN/PVID, MAC address, LAN and PON packet counters, PON byte counters, and errors and drops per direction.

**System Information** — device name, firmware, hardware revision, CPU and RAM load, uptime and standards compliance.

Those four lower cards do not overlap: each covers one subsystem and nothing else.

**Diagnostic Threshold Limits** — every reading against its low alarm, low warning, high warning and high alarm. The limits come from the backend payload, so the table and the status badges cannot disagree.

## Settings

Under **Status → HSGQ SFP DDM → Settings**: module address, protocol (HTTP or HTTPS), port, credentials, polling interval, connection timeout, unit system (dual, metric or imperial) and optical class.

Telnet and SSH are not offered. The datasheet lists them, but on the unit tested only port 80 is open, and the backend has always scraped the web interface — the options were never reachable code paths.

Settings survive both package upgrade (`conffiles`) and firmware reflash (`/lib/upgrade/keep.d`).

## How it works

An rpcd script at `/usr/libexec/rpcd/hsqg_ddm` logs into the module's Boa web interface, fetches six status pages reusing one session, and parses them in a single `awk` pass into the dashboard JSON.

`curl` is a hard requirement. The previous `wget` fallback discarded the login response and never saved a cookie jar, so every subsequent fetch was unauthenticated and the user was told the host had timed out when authentication had silently never happened. BusyBox `wget` and `uclient-fetch` have no cookie support, so that path could not be repaired portably; its absence is now reported plainly instead.

The login password is fed to `curl` on stdin rather than the command line, where any local user could read it from `ps`. The cookie jar and cache are created `0600`.

The datasheet publishes wavelengths of 1310 nm upstream and 1490 nm downstream, SFF-8472 DDM compliance, and compliance with ITU-T G.984.2 and Amendment 1 — but no power budget class and no sensitivity or launch figures. Only port 80 is open, so there is no CLI path to the module's own SFF-8472 threshold bytes either. The optical limits shown are therefore ITU-T G.984.2 Class B+ figures used as a documented assumption; if an optic names a class in its vendor or part string, that is used instead and marked as coming from the hardware. The connector is likewise unreported — the datasheet states only `type: SC` and the stick ships with either polish.

## Changelog

### 1.0.1-r1

**OMCI managed entities, as their own cards.** The stick's `omcicli` output is read and rendered per managed entity — Ethernet UNI (ME 11), VLAN tag filter (ME 84), extended VLAN tagging (ME 171), ONT-G (ME 256), VEIP (ME 329) and OLT identification (ME 131). The OLT vendor arrives as four packed ASCII bytes in a hex word and is decoded alongside the raw value.

The CLI output is not clean and is not scraped as if it were. Instances are delimited by runs of `=`, every line is separated by a blank, ME 171 nests a repeating filter/treatment table, and some fields carry raw bytes rather than text. `omci.awk` parses the structure and sanitises to printable ASCII, so a firmware that emits control bytes cannot produce unparseable output. It runs identically under gawk, mawk and BusyBox awk.

**OMCI state survives a page reload and a dark fibre.** Managed entities are provisioning state, not telemetry: they were being cleared whenever the link dropped or the page was reloaded, so a fault took the configuration view down with it exactly when it was most worth reading. The lifecycle is now tied to link state deliberately rather than incidentally.

**A restart control for the stick**, declared under ACL write rather than read, because it changes device state rather than reporting it.

**24 hours of history, held in RAM.** A circular time-series buffer with a background collector and its own init script, feeding full-width charts for RX, TX, temperature and bias. The range switcher covers 1h/6h/12h/24h with subdivisions that follow the selected window, hourly gridlines, and alarm colouring carried onto the header readings.

**FEC reporting follows ITU-T G.984.3** OLT management terminology rather than the module's own wording.

**Factory SFP calibration and descriptors** are carried from the published GPON specification instead of being inferred.

**Laser off is shown as laser off** in the dial, the statistics, the chart and the threshold matrix when TX reads zero or null — a definite state the module reported, not a missing reading.

Fixes: history telemetry is parsed with POSIX constructs that BusyBox `awk` accepts; threshold limits resolve through `buildThresholds` so alarm colouring stays correct on a dark fibre; the chart X-axis no longer labels the newest point `Now`; the TX dial key is corrected; and the key/value layout stays horizontal on small screens.

The ACL no longer grants `get_info`. That method exists nowhere in the backend or the frontend — it was a permission for something that was never callable.

### 1.0.0-r1

First release.

## License

Apache-2.0. See [LICENSE](LICENSE).
