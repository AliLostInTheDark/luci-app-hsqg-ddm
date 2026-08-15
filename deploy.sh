#!/bin/sh
# Deploy luci-app-hsqg-ddm to live OpenWrt router using APK ADD ONLY
# Usage: ./deploy.sh [ROUTER_IP] (default: 192.168.10.1)
set -e

ROUTER_IP="${1:-192.168.10.1}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
HOST_APK="/home/ali/openwrt-jidu6j11/staging_dir/host/bin/apk"

echo "==> Deploying luci-app-hsqg-ddm to OpenWrt router at $ROUTER_IP via APK package manager..."

# 1. Determine router architecture
TARGET_ARCH=$(ssh -o StrictHostKeyChecking=no "root@$ROUTER_IP" "source /etc/os-release 2>/dev/null; [ -n \"\$OPENWRT_ARCH\" ] && echo \"\$OPENWRT_ARCH\" || cat /etc/apk/arch 2>/dev/null || uname -m")
if [ -z "$TARGET_ARCH" ]; then
    TARGET_ARCH="aarch64_cortex-a53"
fi
echo "==> Target router architecture: $TARGET_ARCH"

TMP_DIR="/tmp/apk_build_hsqg_${TARGET_ARCH}"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR/www/luci-static/resources/view/hsqg_ddm" \
         "$TMP_DIR/usr/libexec/rpcd" \
         "$TMP_DIR/usr/share/luci/menu.d" \
         "$TMP_DIR/usr/share/rpcd/acl.d" \
         "$TMP_DIR/etc/config" \
         "$TMP_DIR/etc/uci-defaults" \
         "$TMP_DIR/lib/upgrade/keep.d"

cp -r "$SCRIPT_DIR/htdocs/luci-static/resources/view/hsqg_ddm/"* "$TMP_DIR/www/luci-static/resources/view/hsqg_ddm/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/etc/config/"* "$TMP_DIR/etc/config/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/etc/uci-defaults/"* "$TMP_DIR/etc/uci-defaults/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/usr/libexec/rpcd/"* "$TMP_DIR/usr/libexec/rpcd/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/usr/share/luci/menu.d/"* "$TMP_DIR/usr/share/luci/menu.d/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/usr/share/rpcd/acl.d/"* "$TMP_DIR/usr/share/rpcd/acl.d/" 2>/dev/null || true
# Sysupgrade retention list. Unconditional: if this is missing the package still
# installs, but /etc/config survives a reflash only by base-files' default list.
cp "$SCRIPT_DIR/root/lib/upgrade/keep.d/luci-app-hsqg-ddm" "$TMP_DIR/lib/upgrade/keep.d/luci-app-hsqg-ddm"

chmod -R u=rwX,go=rX "$TMP_DIR"
chmod 0755 "$TMP_DIR/usr/libexec/rpcd/"* "$TMP_DIR/etc/uci-defaults/"* 2>/dev/null || true

APK_FILE="/tmp/luci-app-hsqg-ddm-1.0.0-r1_${TARGET_ARCH}.apk"
"$HOST_APK" mkpkg \
    --info "name:luci-app-hsqg-ddm" \
    --info "version:1.0.0-r1" \
    --info "arch:$TARGET_ARCH" \
    --info "description:LuCI support for HSGQ Realtek SFP DDM Telemetry" \
    --files "$TMP_DIR" \
    -o "$APK_FILE"

rm -rf "$TMP_DIR"

# 2. Transfer and install
echo "==> Streaming $APK_FILE to root@$ROUTER_IP:/tmp/..."
cat "$APK_FILE" | ssh -o StrictHostKeyChecking=no "root@$ROUTER_IP" "cat > /tmp/luci-app-hsqg-ddm.apk && apk add --allow-untrusted /tmp/luci-app-hsqg-ddm.apk && rm -f /tmp/luci-app-hsqg-ddm.apk && rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache* /tmp/hsqg_ddm_cache.json /tmp/luci-sessions/* && /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart"

echo "==> [SUCCESS] Package successfully installed via apk add!"
echo "==> Access dashboard at: http://$ROUTER_IP/cgi-bin/luci/admin/status/hsqg_ddm"
exit 0
