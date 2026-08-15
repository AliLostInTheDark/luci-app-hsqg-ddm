# luci-app-hsqg-ddm

LuCI optical diagnostics for the **HSGQ XPON STICK** and other Realtek RTL960x
SFP ONU sticks. Scrapes the module's Boa web interface and renders the telemetry
as a dashboard under **Status → HSGQ SFP DDM**.

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Supported devices](#supported-devices)
- [Dashboard cards](#dashboard-cards)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Optical limits](#optical-limits)
- [Development](#development)
- [License](#license)

## Highlights

- Receive and transmit optical power, transceiver temperature, supply voltage and
  laser bias current, read live from the module.
- Loss of Signal asserted on **both** sides of the receiver window — below
  sensitivity and above overload — because a saturated receiver loses framing just
  as thoroughly as a dark one.
- Reports the optic's **own** identity (`ODI / DFP-34X-2C2` on the unit this was
  developed against) separately from the OMCI emulated identity, which describes
  the ONU the stick pretends to be rather than the optic fitted to it.
- The optical class is labelled **assumed** unless the optic names one. The HSGQ
  datasheet cites ITU-T G.984.2 and Amendment 1 but publishes no power budget
  class and no sensitivity or launch figures, and the module reports none — so
  presenting a class as confirmed would be an invention.
- A value the module did not report is shown as `--`, never as a plausible default
  and never as a fake alarm. A transmitter the module reports as off reads
  **Laser Off**, not "Unknown".
- Instant page load: a cached reading paints immediately and refreshes behind the
  response, bounded so a dead link cannot masquerade as a healthy one.

## Installation

### One line, key and package together

```sh
wget -qO /etc/apk/keys/luci-app-hsqg-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-hsqg-ddm/main/keys/luci-app-hsqg-ddm.pem && wget -qO /tmp/hsqg.apk "$(wget -qO- https://api.github.com/repos/AliLostInTheDark/luci-app-hsqg-ddm/releases/latest | sed -n 's/.*"browser_download_url": *"\([^"]*\.apk\)".*/\1/p' | head -1)" && apk add /tmp/hsqg.apk && rm -f /tmp/hsqg.apk
```

### Manually, or from the LuCI Software page

**Install the signing key first — once per router.** Every release is signed, so
with the key in place `apk` accepts the package normally: no `--allow-untrusted`,
and uploading the file on **System → Software** just works.

```sh
wget -qO /etc/apk/keys/luci-app-hsqg-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-hsqg-ddm/main/keys/luci-app-hsqg-ddm.pem
```

```sh
apk add ./luci-app-hsqg-ddm-<version>.apk
```

<details>
<summary>What that key is, and what trusting it means</summary>

`keys/luci-app-hsqg-ddm.pem` is the **public** half of the EC keypair this project
signs with; the private half never leaves the build machine. Its SHA-256 is
`09069032 22035518 95a5ab10 96e7abee 6a005144 8c423fd4 8315d15f e17b0e0c`.

Installing it into `/etc/apk/keys/` tells `apk` to accept packages signed by that
key, which is the same trust model every OpenWrt package feed uses. It grants
nothing else, and removing the file revokes it.

`apk add --allow-untrusted ./luci-app-hsqg-ddm-<version>.apk` still works and
skips verification entirely.

</details>

### From source

```sh
git clone https://github.com/AliLostInTheDark/luci-app-hsqg-ddm
cp -r luci-app-hsqg-ddm <openwrt>/package/luci-app-hsqg-ddm
make package/luci-app-hsqg-ddm/compile V=s
```

Architecture-independent. Requires `curl` at runtime, declared in the Makefile.

## Supported devices

Built for and tested against the **HSGQ XPON STICK** (GPON/EPON adaptive SFP ONU,
Realtek RTL960x, Boa web interface). It should work with other RTL960x sticks
serving the same `status_pon.asp`, `status.asp`, `gpon.asp`, `omci_info.asp`,
`stats.asp` and `vlan.asp` pages.

Verified against firmware `V1.1.6-240202`, optic `ODI DFP-34X-2C2`, on OpenWrt
25.12.

## Dashboard cards

**Received Optical Power (RX)** — current level, the usable receiver window
(sensitivity to overload, which are the LOS assert points), signal quality and
wavelength.

**Transmitted Optical Power (TX)** — launch power, transmitter state and
wavelength. The module reports `-inf dBm` when the laser is off; that is shown as
**Laser Off**, distinct from an unknown reading.

**Operating Temperature** — transceiver temperature, supply voltage and laser bias
current. The datasheet rating is shown for reference but is deliberately not used
for grading: the DDM reading is the transceiver's *internal* temperature, which
normally sits above ambient, so grading it against an ambient rating would raise
alarms that mean nothing. The stick ships in C-Temp (0…70 °C) and I-Temp
(−40…85 °C) variants and does not report which is fitted, so both are shown.
Alarm bands follow SFF-8472.

**GPON & OMCI Management** — ONU activation state, registration, serial number,
FEC and optical alarms.

**Transceiver & BOSA Diagnostics** — the optic's own vendor and part number, class
and its provenance, wavelengths, supply voltage, bias, hardware revision.

**Ethernet & Network Performance** — LAN status, VLAN/PVID, LAN and PON counters,
errors and drops, MAC, CPU and RAM load, uptime.

**SFF-8472 Diagnostic Threshold Limits** — every reading against its low alarm,
low warning, high warning and high alarm. These come from the backend payload, so
the table and the status badges cannot disagree.

## Settings

Under **Status → HSGQ SFP DDM → Settings**: module address, protocol (HTTP or
HTTPS), port, credentials, polling interval, connection timeout, unit system and
optical class.

Telnet and SSH are not offered. The datasheet lists them, but on the unit tested
only port 80 is open, and the backend has always scraped the web interface — the
options were never reachable code paths.

Settings survive both package upgrade (`conffiles`) and firmware reflash
(`/lib/upgrade/keep.d`).

## How it works

An rpcd script at `/usr/libexec/rpcd/hsqg_ddm` logs into the module's Boa web
interface, fetches six status pages reusing one session, and parses them in a
single `awk` pass into the dashboard JSON contract. The LuCI view renders it.

`curl` is a hard requirement. The previous `wget` fallback discarded the login
response and never saved a cookie jar, so every subsequent fetch was
unauthenticated and the user was told the host had timed out when authentication
had silently never happened. BusyBox `wget` and `uclient-fetch` have no cookie
support, so that path could not be repaired portably; its absence is now reported
plainly instead.

The login password is fed to `curl` on stdin rather than the command line, where
any local user could read it from `ps`. The cookie jar and cache are `0600`.

## Optical limits

| | value | source |
|---|---|---|
| Wavelengths | TX 1310 nm, RX 1490 nm | HSGQ datasheet |
| DDM compliance | SFF-8472 | HSGQ datasheet |
| Standards cited | ITU-T G.984.2 + Amd.1, G.988 OMCI | HSGQ datasheet |
| Temperature, voltage, bias | SFF-8472 | SFF-8472 |
| RX/TX optical limits | **not published** | — |

The datasheet publishes no power budget class and no sensitivity or launch
figures, and the module exposes no SFF-8472 A2h threshold bytes over its web
interface — only port 80 is open, so there is no CLI path to them either. The
optical limits shown are therefore ITU-T G.984.2 Class B+ figures used as a
**stated assumption**, labelled *(assumed - not reported by module)* in the UI.
If an optic names a class in its vendor or part string, that is used instead and
marked as coming from the hardware.

The connector is likewise unreported — the datasheet states only `type: SC`, and
the stick ships with either polish — so the dashboard says so rather than
guessing.

## Development

```sh
./deploy.sh <router-ip>     # build, package and install over SSH
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the check regime. The embedded `awk`
program must parse under `awk`, `mawk` **and** `busybox awk`, since BusyBox is
what runs on the router and is much the strictest of the three.

## License

Apache-2.0. See [LICENSE](LICENSE).
