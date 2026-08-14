include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-hsqg-ddm
LUCI_TITLE:=HSGQ SFP Stick DDM & Optical Diagnostics Monitor
LUCI_DEPENDS:=+luci-base +curl
LUCI_PKGARCH:=all
PKG_VERSION:=1.0.0
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=OpenWrt Community

include $(TOPDIR)/feeds/luci/luci.mk

define Package/luci-app-hsqg-ddm/conffiles
/etc/config/hsqg_ddm
endef

define Package/luci-app-hsqg-ddm/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -f /tmp/luci-indexcache.*
	rm -rf /tmp/luci-modulecache/
	/etc/init.d/rpcd restart 2>/dev/null
	exit 0
}
endef

# call BuildPackage - OpenWrt buildroot signature
