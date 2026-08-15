---
name: Bug report
about: Something reports the wrong value, or does not work
labels: bug
---

## What happened

<!-- What the dashboard showed, and what you expected instead. -->

## What the device itself reports

This is the most useful thing you can attach. Run on the router:

```sh
ubus call hsqg_ddm get_status
```

<!-- Paste the JSON. Redact the serial number and MAC if you would rather not
     share them; everything else is diagnostic. -->

Also useful, since it shows what the stick reported before any parsing:

```sh
# on the router
curl -s -c /tmp/c -d "username=<user>&password=<pass>&save=Login&submit-url=/admin/login.asp" \
  "http://<stick-ip>/boaform/admin/formLogin" >/dev/null
curl -s -b /tmp/c "http://<stick-ip>/status_pon.asp" | sed -e 's/<[^>]*>/ /g' | tr -s ' \n'
```


## Environment

- OpenWrt version: <!-- cat /etc/os-release -->
- Router model / architecture:
- Package version: <!-- apk info luci-app-hsqg-ddm   or   opkg list-installed | grep luci-app-hsqg-ddm -->
- SFP stick firmware version:

## Notes

If a reading looks wrong rather than missing, please say what you believe the
correct value is and how you know. A reading that disagrees with the vendor's own
web interface is a much stronger report than one that merely looks surprising.
