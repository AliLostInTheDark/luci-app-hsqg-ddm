#!/bin/sh
# Deployment script for OpenWrt (uses tar over SSH)
# Usage: ./deploy.sh [ROUTER_IP] (default: 192.168.10.1)

ROUTER_IP="${1:-192.168.10.1}"

echo "Deploying luci-app-hsqg-ddm to OpenWrt router at $ROUTER_IP..."

# 1. Deploy system files (root/ -> /)
echo "1/3 Copying configuration and backend files..."
tar -C root -cf - . | ssh -o StrictHostKeyChecking=no "root@${ROUTER_IP}" "tar -xf - -C /"

# 2. Deploy Web UI resources (htdocs/ -> /www/)
echo "2/3 Copying LuCI JavaScript views..."
ssh -o StrictHostKeyChecking=no "root@${ROUTER_IP}" "mkdir -p /www/luci-static/resources/view/hsqg_ddm"
tar -C htdocs -cf - . | ssh -o StrictHostKeyChecking=no "root@${ROUTER_IP}" "tar -xf - -C /www/"

# 3. Fix permissions and restart services
echo "3/3 Initializing backend and reloading LuCI..."
ssh -o StrictHostKeyChecking=no "root@${ROUTER_IP}" "
	chmod +x /usr/libexec/rpcd/hsqg_ddm
	/etc/init.d/rpcd restart
	sleep 1
	rm -rf /tmp/luci-indexcache /tmp/luci-modulecache

	echo '---------------------------------------------------'
	echo 'Checking ubus registration for hsqg_ddm:'
	if ubus list | grep -q 'hsqg_ddm'; then
		echo '[SUCCESS] ubus object hsqg_ddm registered!'
		echo 'Querying live data from HSGQ stick:'
		ubus call hsqg_ddm get_status
	else
		echo '[WARN] rpcd re-scanning, checking direct script test:'
		/usr/libexec/rpcd/hsqg_ddm call get_status
	fi
	echo '---------------------------------------------------'
	echo 'Navigate to: Status -> HSGQ SFP DDM in your browser.'
"
