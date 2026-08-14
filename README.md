# `luci-app-hsqg-ddm`

**HSGQ / Realtek RTL960x SFP Stick DDM & Optical Diagnostics Dashboard for OpenWrt LuCI**

A responsive hardware telemetry dashboard for OpenWrt routers to monitor HSGQ and Realtek RTL960x-based GPON / EPON / XPON SFP ONU sticks (e.g., HSGQ-G2.5G, SRCM JCO4032, V2801F, DFP-34X-2C2, ODI DFP-34G-2C2).

---

## Features

- **Live DDM Telemetry**: Real-time Optical RX Power (dBm / µW), TX Power, Operating Temperature (°C / °F), Supply Voltage (VCC), and Laser Bias Current.
- **Dual Measurement Engine**: Seamless toggle between `Dual (Metric / Imperial)`, `Metric (°C, dBm)`, and `Imperial (°F, µW)`.
- **GPON & OMCI Identification**: Extracts GPON Serial Number (SN), MAC Address, untruncated MACKEY, OMCI Software Versions (SW1 / SW2), Hardware Revisions, and ITU-T G.984 ONU registration states (`O1` to `O7`).
- **Network & Traffic Monitoring**: LAN interface status, VLAN configuration (PVID), Module CPU load, Memory usage, and live packet counters.
- **SFF-8472 Diagnostic Limits Matrix**: Comprehensive threshold compliance table tracking High/Low Alarm and Warning bounds.
- **Universal Multi-Theme Adaptability**: Designed with CSS variables for seamless compatibility across all LuCI themes (Argon, Bootstrap, Material, Rosy, OpenWrt 2020) in both Dark and Light modes.
- **High-Performance Caching**: Instantaneous 0 ms initial dashboard rendering with client-side hydration and server-side rpcd session caching.
- **Native LuCI Polling**: Integrated with LuCI's master `poll.add` lifecycle engine.

---

## Installation

### 1. Via OpenWrt Package Manager (`apk`)
Modern OpenWrt snapshot and master releases use Alpine Package Keeper (`apk`):

```bash
# Copy package to router
scp luci-app-hsqg-ddm-1.0.0-r1.apk root@192.168.1.1:/tmp/

# Install package
apk add --allow-untrusted /tmp/luci-app-hsqg-ddm-1.0.0-r1.apk
```

### 2. Manual / Development Deployment
Deploy directly over SSH from this repository:

```bash
./deploy.sh <router-ip>
# Example: ./deploy.sh 192.168.10.1
```

---

## Architecture & File Hierarchy

```
luci-app-hsqg-ddm/
├── Makefile                                     # OpenWrt package build definition
├── deploy.sh                                    # Quick SSH synchronization script
├── LICENSE                                      # Apache-2.0 License
├── README.md                                    # Documentation
├── htdocs/
│   └── luci-static/resources/view/hsqg_ddm/
│       ├── dashboard.js                         # Main LuCI flexbox dashboard view
│       └── settings.js                          # Configuration & connectivity view
└── root/
    ├── etc/
    │   ├── config/hsqg_ddm                      # UCI configuration file
    │   └── uci-defaults/80_luci-app-hsqg-ddm    # LuCI default permission bootstrap
    ├── usr/
    │   ├── libexec/rpcd/hsqg_ddm                # Backend telemetry & session engine
    │   └── share/
    │       ├── luci/menu.d/luci-app-hsqg-ddm.json # LuCI top navigation menu entry
    │       └── rpcd/acl.d/luci-app-hsqg-ddm.json  # ubus RPC access permissions
```

---

## UCI Configuration (`/etc/config/hsqg_ddm`)

```uci
config hsqg_ddm 'main'
	option enabled '1'
	option host '192.168.150.1'
	option username 'admin'
	option password 'Admin@1234567890'
	option poll_interval '3'
	option timeout '2'
	option unit_system 'dual'
```

---

## Backend RPC Interface (`ubus`)

```bash
# Query complete telemetry data
ubus call hsqg_ddm get_status

# Test connection to SFP stick
ubus call hsqg_ddm test_connection
```

---

## License

Licensed under the **Apache License, Version 2.0**.
