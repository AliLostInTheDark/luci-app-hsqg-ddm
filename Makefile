#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-hsqg-ddm
LUCI_NAME:=luci-app-hsqg-ddm
LUCI_TITLE:=HSGQ SFP Stick DDM & Optical Diagnostics Monitor
LUCI_DESCRIPTION:=LuCI hardware telemetry dashboard for HSGQ and Realtek-based SFP stick optical diagnostics.
LUCI_DEPENDS:=+luci-base +curl

# This package is pure shell, JavaScript and JSON -- it ships no compiled object
# for the target -- so it is genuinely architecture independent. (The sibling
# luci-app-vsol-ddm is NOT: it ships a target ELF helper, /usr/bin/vsol_query,
# and therefore must stay architecture specific.)
LUCI_PKGARCH:=all

PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=OpenWrt LuCI community
PKG_URL:=https://github.com/AliLostInTheDark/luci-app-hsqg-ddm

# ---------------------------------------------------------------------------
# These three blocks MUST be defined before luci.mk is included.
#
# luci.mk calls BuildPackage itself, on its very last line. BuildPackage in turn
# expands include/package-pack.mk, which reads the conffiles list immediately
# ("KEEP_$(1):=$(strip $(call Package/$(1)/conffiles))") and gates the maintainer
# scripts on an immediate "ifdef Package/$(1)/<script>". Anything defined after
# the include is therefore evaluated too late and is silently dropped -- the
# package would build cleanly and simply lose /etc/config/hsqg_ddm on upgrade.
# ---------------------------------------------------------------------------

# Retained across package upgrade. Sysupgrade retention is handled separately by
# /lib/upgrade/keep.d/luci-app-hsqg-ddm, shipped under root/.
define Package/luci-app-hsqg-ddm/conffiles
/etc/config/hsqg_ddm
endef

define Package/luci-app-hsqg-ddm/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache* /tmp/hsqg_ddm_cache.json /tmp/luci-sessions/*
	/etc/init.d/rpcd reload 2>/dev/null || true
	/etc/init.d/rpcd restart 2>/dev/null || true
	/etc/init.d/uhttpd restart 2>/dev/null || true
}
exit 0
endef

define Package/luci-app-hsqg-ddm/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache* /tmp/hsqg_ddm_cache.json /tmp/luci-sessions/*
	/etc/init.d/rpcd reload 2>/dev/null || true
	/etc/init.d/uhttpd restart 2>/dev/null || true
}
exit 0
endef

# luci.mk installs htdocs/ under /www and the whole of root/ under / with
# "cp -pR", preserving the source file modes -- so root/usr/libexec/rpcd/hsqg_ddm
# and root/etc/uci-defaults/80_luci-app-hsqg-ddm must stay mode 0755 in git.
include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
