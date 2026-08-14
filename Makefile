#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-hsqg-ddm
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=OpenWrt Community

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-hsqg-ddm
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=HSGQ SFP Stick DDM & Optical Diagnostics Monitor
  DEPENDS:=+luci-base +curl
  PKGARCH:=all
endef

define Package/luci-app-hsqg-ddm/description
  LuCI hardware telemetry dashboard for HSGQ and Realtek-based SFP stick optical diagnostics.
endef

define Package/luci-app-hsqg-ddm/conffiles
/etc/config/hsqg_ddm
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

define Package/luci-app-hsqg-ddm/install
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/hsqg_ddm
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/hsqg_ddm/* $(1)/www/luci-static/resources/view/hsqg_ddm/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/hsqg_ddm $(1)/etc/config/hsqg_ddm

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/* $(1)/etc/uci-defaults/ 2>/dev/null || true

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/* $(1)/usr/libexec/rpcd/

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/* $(1)/usr/share/luci/menu.d/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/* $(1)/usr/share/rpcd/acl.d/
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

$(eval $(call BuildPackage,luci-app-hsqg-ddm))
