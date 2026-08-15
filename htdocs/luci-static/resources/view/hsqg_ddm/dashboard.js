'use strict';
'require view';
'require rpc';
'require poll';
'require uci';

var callGetStatus = rpc.declare({
	object: 'hsqg_ddm',
	method: 'get_status',
	expect: {}
});

var callGetOmci = rpc.declare({
	object: 'hsqg_ddm',
	method: 'get_omci',
	expect: {}
});

var callRestart = rpc.declare({
	object: 'hsqg_ddm',
	method: 'restart_stick',
	expect: {}
});

var hexToAscii = function(v) {
	if (typeof v !== 'string') return null;
	var h = v.replace(/^0x/i, '');
	if (!/^[0-9a-fA-F]+$/.test(h) || h.length % 2) return null;
	var out = '';
	for (var i = 0; i < h.length; i += 2) {
		var c = parseInt(h.substr(i, 2), 16);
		if (c < 32 || c > 126) return null;
		out += String.fromCharCode(c);
	}
	return out.length ? out : null;
};

var OMCI_CARDS = [
	{ id: '11',  title: _('Ethernet UNI'), sub: _('ME 11 — physical Ethernet user network interfaces') },
	{ id: '84',  title: _('VLAN Tag Filter'), sub: _('ME 84 — downstream / upstream packet filters') },
	{ id: '131', title: _('OLT-G Identification'), sub: _('ME 131 — upstream OLT system profile and vendor') },
	{ id: '256', title: _('ONT-G Profile'), sub: _('ME 256 — optical network terminal general configuration') },
	{ id: '171', title: _('Extended VLAN Tagging'), sub: _('ME 171 — tagging and translation rules') },
	{ id: '329', title: _('VEIP'), sub: _('ME 329 — virtual Ethernet interface point') }
];

/*
 * Severity palette (shared with luci-app-vsol-ddm — keep the two identical).
 * Every quality evaluator returns { color, bg, label, badge, severity }; all five
 * keys are mandatory on every return path, which is why they are built by grade().
 */
var SEVERITY_PALETTE = {
	alarm:   { color: '#ff5252', bg: 'rgba(255,82,82,0.16)' },
	warn:    { color: '#ffb300', bg: 'rgba(255,179,0,0.16)' },
	optimal: { color: '#8bc34a', bg: 'rgba(139,195,74,0.16)' },
	off:     { color: '#9e9e9e', bg: 'rgba(158,158,158,0.18)' }
};

/* Accent for informational, non-graded values. */
var ACCENT_COLOR = '#00bcd4';

/*
 * Optical class profiles. These are the only optical figures this view may use;
 * anything else must come from the backend `thresholds` payload.
 */
var OPTICAL_CLASSES = {
	bplus: {
		rx_sensitivity_dbm: -27.0,
		rx_overload_dbm:     -8.0,
		tx_min_dbm:           0.5,
		tx_max_dbm:           5.0,
		wavelength_rx_nm:    1490,
		wavelength_tx_nm:    1310,
		citation: 'ITU-T G.984.2 Class B+'
	},
	cplus: {
		rx_sensitivity_dbm: -32.0,
		rx_overload_dbm:    -12.0,
		tx_min_dbm:           0.5,
		tx_max_dbm:           5.0,
		wavelength_rx_nm:    1490,
		wavelength_tx_nm:    1310,
		citation: 'ITU-T G.984.2 Amd.2 Class C+'
	},
	epon_px20: {
		rx_sensitivity_dbm: -24.0,
		rx_overload_dbm:     -3.0,
		tx_min_dbm:           2.0,
		tx_max_dbm:           7.0,
		wavelength_rx_nm:    1490,
		wavelength_tx_nm:    1310,
		citation: 'IEEE 802.3ah 1000BASE-PX20-U'
	}
};

/* Transceiver diagnostics, class-independent (SFF-8472). */
var SFF_THRESHOLDS = {
	temp_low_alarm:  -40.0, temp_low_warn:  -10.0,
	temp_high_warn:   75.0, temp_high_alarm: 85.0,
	volt_low_alarm:   2.90, volt_low_warn:   3.05,
	volt_high_warn:   3.55, volt_high_alarm: 3.70,
	bias_low_alarm:    1.0, bias_low_warn:    2.0,
	bias_high_warn:   60.0, bias_high_alarm: 70.0,
	citation: 'SFF-8472'
};

/* Below this the fibre is considered dark rather than merely below sensitivity. */
var DARK_FIBRE_DBM = -35.0;
/* Below this the transmitter is treated as switched off, not as an alarm. */
var LASER_OFF_DBM = -35.0;

return view.extend({
	unitSystem: 'dual',

	load: function() {
		return Promise.all([
			uci.load('hsqg_ddm'),
			callGetStatus()
		]);
	},

	render: function(data) {
		var self = this;
		var initialStatus = data[1] || {};

		/* Polling interval is clamped to a sane 1..60 s window. */
		var pollInterval = parseInt(uci.get('hsqg_ddm', 'main', 'poll_interval'), 10);
		if (isNaN(pollInterval)) pollInterval = 3;
		pollInterval = Math.min(60, Math.max(1, pollInterval));

		/* Unit system is managed exclusively via Settings (UCI). */
		self.unitSystem = uci.get('hsqg_ddm', 'main', 'unit_system') || 'dual';
		self.configuredClass = uci.get('hsqg_ddm', 'main', 'optical_class') || 'bplus';

		/* One-off cleanup of keys written by earlier releases; nothing reads them. */
		if (window.localStorage) {
			try {
				window.localStorage.removeItem('hsqg_unit_system');
				window.localStorage.removeItem('hsqg_last_telemetry');
			} catch(e) {}
		}

		var container = E('div', {
			id: 'hw-dashboard',
			class: 'hw-dashboard'
		});

		var style = E('style', {},
			' .hw-dashboard { display: flex; flex-wrap: wrap; align-items: stretch; gap: 20px; padding: 15px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; width: 100%; max-width: 100%; overflow: hidden; color: var(--text-color, inherit); }' +
			/* The container itself must be included, not just its descendants: it
			 * carries width:100% AND padding, so leaving it content-box makes the
			 * page exceed the viewport by exactly its own padding and scroll
			 * sideways at tablet widths. */
			' .hw-dashboard, .hw-dashboard * { box-sizing: border-box; }' +
			' .hw-card { flex: 1 1 300px; min-width: 0; background: var(--background-color-high, rgba(128, 128, 128, 0.05)); border: 1px solid var(--border-color, rgba(128, 128, 128, 0.18)); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; color: var(--text-color, inherit); position: relative; box-shadow: 0 2px 8px rgba(0,0,0,0.06); max-width: 100%; overflow: hidden; }' +
			' .hw-card.wide { flex: 1 1 100%; align-items: stretch; }' +
			/* A card that occupies a full row would otherwise strand each label
			 * at the far left and its value at the far right. Flowing the pairs
			 * into columns keeps them readable at any width. */
			' .hw-kv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 28px; width: 100%; }' +
			' .hw-actionbar { flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border: 1px solid var(--border-color, rgba(128,128,128,0.18)); border-radius: 12px; background: var(--background-color-high, rgba(128,128,128,0.05)); }' +
			' .hw-actionbar-title { font-size: 0.95em; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; opacity: 0.85; }' +
			' .hw-actionbar-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }' +
			' .hw-actionbar-note { font-size: 0.72em; opacity: 0.65; width: 100%; margin: 0; }' +
			' .hw-omci-wrap { flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: stretch; gap: 20px; }' +
			' .hw-omci-inst { width: 100%; margin: 0 0 12px 0; padding: 10px 12px; border: 1px solid var(--border-color, rgba(128,128,128,0.15)); border-radius: 8px; }' +
			' .hw-omci-inst:last-child { margin-bottom: 0; }' +
			' .hw-omci-eid { font-size: 0.75em; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.8; margin: 0 0 8px 0; }' +
			' .hw-omci-tbl { width: 100%; border-collapse: collapse; font-size: 0.76em; }' +
			' .hw-omci-tbl th, .hw-omci-tbl td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border-color, rgba(128,128,128,0.12)); white-space: nowrap; }' +
			' .hw-omci-tbl th { font-weight: 700; opacity: 0.7; }' +
			' .hw-omci-tbl td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }' +
			' .hw-omci-empty { font-size: 0.78em; opacity: 0.6; text-align: center; padding: 12px 0; }' +
			' .hw-card.half { flex: 1 1 calc(50% - 10px); align-items: stretch; }' +
			' .hw-card h3 { margin: 0 0 6px 0; font-size: 1.00em; color: var(--text-color, inherit); opacity: 0.85; text-transform: uppercase; letter-spacing: 0.8px; text-align: center; word-break: break-word; line-height: 1.3; font-weight: 700; }' +
			' .hw-card-sub { margin: 0 0 14px 0; font-size: 0.72em; opacity: 0.62; text-align: center; line-height: 1.3; word-break: break-word; min-width: 0; }' +
			' .hw-banner { flex: 1 1 100%; min-width: 0; display: none; align-items: flex-start; gap: 10px; padding: 12px 16px; border-radius: 10px; border: 1px solid rgba(255,82,82,0.45); background: rgba(255,82,82,0.16); color: #ff5252; font-weight: 600; line-height: 1.35; word-break: break-word; }' +
			' .hw-dashboard.hw-offline .hw-dial { opacity: 0.4; filter: grayscale(1); }' +
			' .hw-dial { position: relative; width: 160px; height: 160px; display: flex; align-items: center; justify-content: center; margin: 4px auto 0 auto; background: transparent !important; }' +
			' .hw-dial svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; transform: rotate(-90deg); background: transparent !important; }' +
			' .hw-dial-bg { fill: none; stroke: var(--border-color, rgba(128, 128, 128, 0.2)); stroke-width: 10; }' +
			' .hw-dial-progress { fill: none; stroke-width: 10; stroke-linecap: round; transition: stroke-dasharray 0.5s ease, stroke 0.5s ease; }' +
			' .hw-dial-center { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; text-align: center; pointer-events: none; }' +
			' .hw-dial-line { font-size: 1.15em; font-weight: 700; letter-spacing: -0.3px; line-height: 1.25; white-space: nowrap; }' +
			' .hw-dial-single { font-size: 1.30em; font-weight: 700; letter-spacing: -0.3px; line-height: 1.2; white-space: nowrap; }' +
			' .hw-status-pill { min-height: 24px; line-height: 1.3; padding: 4px 14px; margin-top: 10px; margin-bottom: 12px; border-radius: 9999px; font-size: 0.76em; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; text-align: center; white-space: normal; word-break: break-word; min-width: 0; box-sizing: border-box; }' +
			' .hw-stats-list { width: 100%; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border-color, rgba(128, 128, 128, 0.12)); padding-top: 14px; margin-top: 2px; }' +
			' .hw-stat-row { display: flex; justify-content: space-between; align-items: baseline; width: 100%; min-height: 22px; line-height: 1.3; min-width: 0; gap: 8px; box-sizing: border-box; }' +
			' .hw-stat-label { opacity: 0.7; font-size: 0.84em; white-space: normal; overflow-wrap: anywhere; flex: 0 1 auto; min-width: 0; line-height: 1.3; }' +
			' .hw-stat-value { font-weight: 700; font-size: 0.86em; white-space: normal; overflow-wrap: anywhere; word-break: normal; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; flex: 1 1 auto; min-width: 0; text-align: right; line-height: 1.35; color: var(--text-color, inherit); }' +
			' .hw-temp-badge { padding: 3px 8px; border-radius: 6px; font-weight: 700; font-size: 0.78em; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; justify-content: center; min-height: 22px; line-height: 1.3; box-sizing: border-box; }' +
			' .hw-temp-crit { animation: hwAlarmBreath 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite !important; will-change: box-shadow, background-color, opacity; }' +
			' @keyframes hwAlarmBreath { 0% { background-color: rgba(255, 82, 82, 0.16); box-shadow: 0 0 2px rgba(255, 82, 82, 0.3); opacity: 0.88; } 50% { background-color: rgba(255, 82, 82, 0.40); box-shadow: 0 0 12px 2px rgba(255, 82, 82, 0.65); opacity: 1; } 100% { background-color: rgba(255, 82, 82, 0.16); box-shadow: 0 0 2px rgba(255, 82, 82, 0.3); opacity: 0.88; } }' +
			' .hw-kv { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%; min-height: 26px; line-height: 1.3; margin-bottom: 6px; min-width: 0; box-sizing: border-box; }' +
			' .hw-kv-k { font-size: 0.76em; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; flex: 0 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.3; }' +
			' .hw-kv-v { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85em; font-weight: 600; word-break: break-word; flex: 1 1 auto; min-width: 0; line-height: 1.3; color: var(--text-color, inherit); }' +
			' .hw-table { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 0.88em; }' +
			' .hw-table th, .hw-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-color, rgba(128, 128, 128, 0.15)); text-align: left; white-space: nowrap; line-height: 1.3; }' +
			' .hw-table th { font-weight: 700; opacity: 0.65; text-transform: uppercase; font-size: 0.78em; letter-spacing: 0.5px; color: var(--text-color, inherit); }' +
			' .hw-table td { color: var(--text-color, inherit); }' +
			' @media (max-width: 640px) {' +
			'   .hw-stat-row { flex-wrap: wrap; }' +
			'   .hw-stat-label { white-space: normal; overflow: visible; text-overflow: clip; }' +
			'   .hw-stat-value { text-align: right; }' +
			' }' +
			' @media (max-width: 600px) {' +
			'   .hw-dashboard .cbi-value-field > input[type=text],' +
			'   .hw-dashboard .cbi-value-field > select { width: 100%; box-sizing: border-box; min-width: 0; }' +
			'   .btn, .cbi-button, button, input[type=button], input[type=submit], input[type=reset] {' +
			'     white-space: nowrap !important; text-overflow: clip !important;' +
			'     max-width: none !important; min-width: max-content !important; box-sizing: border-box !important; }' +
			'   .cbi-page-actions, .right { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; }' +
			' }' +
			' @media (max-width: 480px) {' +
			'   .hw-card { padding: 15px; }' +
			'   .hw-card.half { flex-basis: 100%; }' +
			'   .hw-dial { transform: scale(0.9); }' +
			'   .hw-kv { flex-direction: column; align-items: flex-start; gap: 2px; }' +
			'   .hw-kv-v { text-align: left; overflow-wrap: anywhere; }' +
			/* A label and a signed range cannot share a line at phone widths
			 * without one of them being squeezed, so the stat rows stack the same
			 * way the key/value rows do and both render in full. */
			'   .hw-stat-row { flex-direction: column; align-items: flex-start; gap: 1px; }' +
			'   .hw-stat-label { white-space: normal; }' +
			'   .hw-stat-value { text-align: left; overflow-wrap: anywhere; }' +
			'   .hw-dial-line { font-size: 1.05em; }' +
			' }'
		);

		container.appendChild(style);

		/* Error banner — hidden until the backend reports a failure. */
		var banner = E('div', { id: 'hw-banner', class: 'hw-banner' }, '');
		container.appendChild(banner);

		/* ---------------- Action bar ------------------------------------ */
		var omciWrap = E('div', { id: 'hw-omci-wrap', class: 'hw-omci-wrap' });
		var actionNote = E('p', { class: 'hw-actionbar-note', style: 'display: none;' }, '');

		var setNote = function(msg, colour) {
			actionNote.textContent = msg || '';
			actionNote.style.color = colour || '';
			actionNote.style.display = msg ? '' : 'none';
		};

		var omciBtn = E('button', {
			class: 'cbi-button cbi-button-neutral',
			click: function() { loadOmci(true); }
		}, _('Refresh OMCI'));

		var restartBtn = E('button', {
			class: 'cbi-button cbi-button-negative',
			click: function(ev) {
				if (!confirm(_('Restart the HSGQ SFP stick now? The optical fibre link will drop while it reboots.')))
					return;

				var btn = ev.currentTarget;
				btn.disabled = true;
				setNote(_('Sending restart command to the SFP stick...'));

				callRestart().then(function(res) {
					res = res || {};
					setNote(res.message || res.error || _('Restart command sent.'),
					        res.success ? '' : '#e53935');
					btn.disabled = false;
				}).catch(function(e) {
					setNote(_('Restart failed: ') + (e && e.message ? e.message : String(e)), '#e53935');
					btn.disabled = false;
				});
			}
		}, _('Restart Stick'));

		container.appendChild(E('div', { class: 'hw-actionbar' }, [
			E('div', { class: 'hw-actionbar-title' }, _('HSGQ Realtek RTL960x SFP Stick')),
			E('div', { class: 'hw-actionbar-actions' }, [omciBtn, restartBtn]),
			actionNote
		]));

		// Metric & Imperial Conversion Utilities
		var toFahrenheit = function(c) {
			return (c * 9.0 / 5.0) + 32.0;
		};

		/* Numeric coercion: returns a finite number, or null for null/undefined/NaN. */
		var toNum = function(v) {
			if (v === null || v === undefined || v === '') return null;
			var n = (typeof v === 'number') ? v : parseFloat(String(v));
			return isFinite(n) ? n : null;
		};

		var toMicrowatts = function(dbm) {
			if (dbm === null || !isFinite(dbm) || dbm <= -40) return 0;
			return Math.pow(10, dbm / 10.0) * 1000.0; // In µW
		};

		var fmtTemp = function(c) {
			if (c === null || !isFinite(c)) return '--';
			var f = toFahrenheit(c);
			if (self.unitSystem === 'imperial') return f.toFixed(1) + ' °F';
			if (self.unitSystem === 'dual') return c.toFixed(1) + ' °C / ' + f.toFixed(1) + ' °F';
			return c.toFixed(1) + ' °C';
		};

		var fmtPower = function(dbm) {
			if (dbm === null || !isFinite(dbm)) return '--';
			if (dbm <= LASER_OFF_DBM) {
				return self.unitSystem === 'imperial' ? '0.00 µW' : (self.unitSystem === 'dual' ? _('Off') + ' / 0.00 µW' : _('Laser Inactive'));
			}
			var uw = toMicrowatts(dbm);
			var uwStr = uw < 1 ? uw.toFixed(2) + ' µW' : (uw >= 1000 ? (uw / 1000.0).toFixed(2) + ' mW' : uw.toFixed(1) + ' µW');
			if (self.unitSystem === 'imperial') return uwStr;
			if (self.unitSystem === 'dual') return dbm.toFixed(2) + ' dBm / ' + uwStr;
			return dbm.toFixed(2) + ' dBm';
		};

		var fmtDbmLimit = function(v) {
			if (v === null || !isFinite(v)) return '--';
			return (v > 0 ? '+' : '') + v.toFixed(1) + ' dBm';
		};

		/* Both endpoints carry their own sign, so a range reads unambiguously as
		 * "-27.0 to -8.0 dBm" or "+0.5 to +5.0 dBm" without the reader having to
		 * infer the sign of the second value from the first. Exactly zero takes no
		 * sign, matching the convention datasheets use for a 0 ~ +4 dBm window.
		 * The unit is stated once, at the end, to keep the row short on a phone. */
		var signed = function(v) {
			var t = Math.abs(v).toFixed(1);
			if (v > 0) return '+' + t;
			if (v < 0) return '-' + t;
			return t;
		};

		var rangeText = function(lo, hi, unit) {
			if (lo === null || hi === null || !isFinite(lo) || !isFinite(hi)) return '--';
			return signed(lo) + ' to ' + signed(hi) + ' ' + unit;
		};

		var fmtVolt = function(v) {
			return (v === null || !isFinite(v)) ? '--' : v.toFixed(2) + ' V';
		};

		var fmtBias = function(v) {
			return (v === null || !isFinite(v)) ? '--' : v.toFixed(1) + ' mA';
		};

		// Standard Uptime Formatter (e.g. 2d 14h 50m or 8h 22m)
		var formatUptime = function(upRaw) {
			if (upRaw === null || upRaw === undefined || upRaw === '' || upRaw === '--') return '--';
			if (typeof upRaw === 'number' || /^\d+$/.test(String(upRaw).trim())) {
				var sec = parseInt(upRaw, 10);
				if (isNaN(sec)) return '--';
				var days = Math.floor(sec / 86400);
				var hours = Math.floor((sec % 86400) / 3600);
				var mins = Math.floor((sec % 3600) / 60);
				var out = '';
				if (days > 0) out += days + 'd ';
				if (hours > 0 || days > 0) out += hours + 'h ';
				out += mins + 'm';
				return out || '0m';
			}
			/*
			 * The day group must contain a literal "day"/"days"; making that word optional
			 * lets the group swallow the first digit of the hours field, so "18:07" was
			 * rendered as "1d 8h 7m" and "12:34:56" as "1d 2h 34m".
			 */
			var m = String(upRaw).match(/(?:(\d+)\s*days?,?\s*)?(\d+):(\d+)(?::(\d+))?/i);
			if (m) {
				var d = parseInt(m[1], 10) || 0;
				var h = parseInt(m[2], 10) || 0;
				var mi = parseInt(m[3], 10) || 0;
				var s = '';
				if (d > 0) s += d + 'd ';
				if (h > 0 || d > 0) s += h + 'h ';
				s += mi + 'm';
				return s || '0m';
			}
			return String(upRaw);
		};

		/*
		 * Build every quality object through grade() so that all five keys
		 * (color, bg, label, badge, severity) exist on every return path.
		 */
		var grade = function(severity, label, badge) {
			var p = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.off;
			return { color: p.color, bg: p.bg, label: label, badge: badge, severity: severity };
		};

		var firstNum = function(obj, names) {
			if (!obj || typeof obj !== 'object') return null;
			for (var i = 0; i < names.length; i++) {
				var n = toNum(obj[names[i]]);
				if (n !== null) return n;
			}
			return null;
		};

		var orElse = function(v, fallback) {
			return (v === null || v === undefined) ? fallback : v;
		};

		/*
		 * Single source of truth for both the threshold table and the evaluators.
		 * Everything is taken from the backend payload where present, and falls back
		 * to the profile for the active optical class when the payload is older or
		 * incomplete. The table cells and the badges therefore cannot disagree.
		 */
		/* Renders the governing standard, marked as assumed when the optic did not
		 * state its own class. optical_class_source is "hardware" only when the
		 * vendor or part string carried a B+/C+ marker. */
		var citationLabel = function(th, res) {
			/* The provenance is preserved in the payload as optical_class_source
			 * for anyone reading the JSON. The visible label carries only the
			 * formal designation of the governing recommendation. */
			return th.optical_citation;
		};

		var buildThresholds = function(res) {
			var payload = (res && res.thresholds && typeof res.thresholds === 'object') ? res.thresholds : {};
			var cls = (res && res.optical_class) || self.configuredClass || 'bplus';
			if (!OPTICAL_CLASSES[cls]) cls = 'bplus';
			var prof = OPTICAL_CLASSES[cls];

			var t = {
				optical_class: cls,
				optical_citation: prof.citation,
				sff_citation: SFF_THRESHOLDS.citation
			};

			/* Receiver window — the BOSA limits used as the LOS assert points. */
			t.rx_low_alarm  = orElse(firstNum(payload, ['rx_sensitivity_dbm', 'rx_low_alarm', 'rx_pwr_low_alarm']), prof.rx_sensitivity_dbm);
			t.rx_high_alarm = orElse(firstNum(payload, ['rx_overload_dbm', 'rx_high_alarm', 'rx_pwr_high_alarm']), prof.rx_overload_dbm);
			t.rx_low_warn   = orElse(firstNum(payload, ['rx_low_warn', 'rx_pwr_low_warn']), t.rx_low_alarm + 1.0);
			t.rx_high_warn  = orElse(firstNum(payload, ['rx_high_warn', 'rx_pwr_high_warn']), t.rx_high_alarm - 1.0);

			/* Transmitter launch power window. */
			t.tx_low_alarm  = orElse(firstNum(payload, ['tx_min_dbm', 'tx_low_alarm', 'tx_pwr_low_alarm']), prof.tx_min_dbm);
			t.tx_high_alarm = orElse(firstNum(payload, ['tx_max_dbm', 'tx_high_alarm', 'tx_pwr_high_alarm']), prof.tx_max_dbm);
			t.tx_low_warn   = orElse(firstNum(payload, ['tx_low_warn', 'tx_pwr_low_warn']), t.tx_low_alarm + 0.5);
			t.tx_high_warn  = orElse(firstNum(payload, ['tx_high_warn', 'tx_pwr_high_warn']), t.tx_high_alarm - 0.5);

			/* Transceiver diagnostics (SFF-8472). */
			t.temp_low_alarm  = orElse(firstNum(payload, ['temp_low_alarm']),  SFF_THRESHOLDS.temp_low_alarm);
			t.temp_low_warn   = orElse(firstNum(payload, ['temp_low_warn']),   SFF_THRESHOLDS.temp_low_warn);
			t.temp_high_warn  = orElse(firstNum(payload, ['temp_high_warn']),  SFF_THRESHOLDS.temp_high_warn);
			t.temp_high_alarm = orElse(firstNum(payload, ['temp_high_alarm']), SFF_THRESHOLDS.temp_high_alarm);

			t.volt_low_alarm  = orElse(firstNum(payload, ['volt_low_alarm', 'voltage_low_alarm']),   SFF_THRESHOLDS.volt_low_alarm);
			t.volt_low_warn   = orElse(firstNum(payload, ['volt_low_warn', 'voltage_low_warn']),     SFF_THRESHOLDS.volt_low_warn);
			t.volt_high_warn  = orElse(firstNum(payload, ['volt_high_warn', 'voltage_high_warn']),   SFF_THRESHOLDS.volt_high_warn);
			t.volt_high_alarm = orElse(firstNum(payload, ['volt_high_alarm', 'voltage_high_alarm']), SFF_THRESHOLDS.volt_high_alarm);

			t.bias_low_alarm  = orElse(firstNum(payload, ['bias_low_alarm']),  SFF_THRESHOLDS.bias_low_alarm);
			t.bias_low_warn   = orElse(firstNum(payload, ['bias_low_warn']),   SFF_THRESHOLDS.bias_low_warn);
			t.bias_high_warn  = orElse(firstNum(payload, ['bias_high_warn']),  SFF_THRESHOLDS.bias_high_warn);
			t.bias_high_alarm = orElse(firstNum(payload, ['bias_high_alarm']), SFF_THRESHOLDS.bias_high_alarm);

			t.wavelength_rx_nm = orElse(firstNum(payload, ['wavelength_rx_nm', 'rx_wavelength_nm']), prof.wavelength_rx_nm);
			t.wavelength_tx_nm = orElse(firstNum(payload, ['wavelength_tx_nm', 'tx_wavelength_nm']), prof.wavelength_tx_nm);

			/* A warning band that sits outside its own alarm band is nonsense; recompute it. */
			if (t.rx_low_warn   < t.rx_low_alarm)    t.rx_low_warn   = t.rx_low_alarm + 1.0;
			if (t.rx_high_warn  > t.rx_high_alarm)   t.rx_high_warn  = t.rx_high_alarm - 1.0;
			if (t.tx_low_warn   < t.tx_low_alarm)    t.tx_low_warn   = t.tx_low_alarm + 0.5;
			if (t.tx_high_warn  > t.tx_high_alarm)   t.tx_high_warn  = t.tx_high_alarm - 0.5;

			return t;
		};

		/*
		 * Diagnostic quality evaluators. Bands come from buildThresholds(), never from
		 * literals, so the matrix table below and these badges are always consistent.
		 */
		var getRxQuality = function(rx, th) {
			if (rx === null) {
				return grade('off', _('UNKNOWN'), _('Unknown'));
			}
			/* LOS is asserted on BOTH sides of the receiver window. */
			if (rx < th.rx_low_alarm) {
				return grade('alarm',
					(rx <= DARK_FIBRE_DBM) ? _('NO SIGNAL / DARK FIBRE') : _('LOSS OF SIGNAL (LOS)'),
					_('LOS Alarm'));
			}
			if (rx > th.rx_high_alarm) {
				return grade('alarm', _('RECEIVER OVERLOAD (LOS)'), _('Overload (LOS)'));
			}
			if (rx < th.rx_low_warn) {
				return grade('warn', _('MARGINAL LOW (WARNING)'), _('Marginal (Low)'));
			}
			if (rx > th.rx_high_warn) {
				return grade('warn', _('HIGH SIGNAL (WARNING)'), _('High (Warning)'));
			}
			return grade('optimal', _('OPTIMAL SIGNAL'), _('Optimal'));
		};

		var getTxQuality = function(tx, th, txStatus) {
			/* The stick reports -inf when the laser is off, which the backend
			 * relays as a null power plus tx_status "off". That is a definite
			 * state the device told us, not an absence of information, so it must
			 * not be flattened into "Unknown". */
			if (txStatus === 'off') {
				return grade('off', _('LASER OFF'), _('Laser Off'));
			}
			if (tx === null) {
				return grade('off', _('UNKNOWN'), _('Unknown'));
			}
			if (tx <= LASER_OFF_DBM) {
				return grade('off', _('LASER INACTIVE'), _('Laser Inactive'));
			}
			if (tx < th.tx_low_alarm) {
				return grade('alarm', _('LOW TX POWER (ALARM)'), _('Low TX Alarm'));
			}
			if (tx > th.tx_high_alarm) {
				return grade('alarm', _('HIGH TX POWER (ALARM)'), _('High TX Alarm'));
			}
			if (tx < th.tx_low_warn) {
				return grade('warn', _('MARGINAL TX (WARNING)'), _('Marginal (Low)'));
			}
			if (tx > th.tx_high_warn) {
				return grade('warn', _('HIGH TX (WARNING)'), _('High (Warning)'));
			}
			return grade('optimal', _('OPTIMAL TX POWER'), _('Optimal'));
		};

		/* SFF-8472 asserts a flag when the reading reaches the limit, hence >= / <=. */
		var getTempQuality = function(temp, th) {
			if (temp === null) {
				return grade('off', _('UNKNOWN'), _('Unknown'));
			}
			if (temp >= th.temp_high_alarm) {
				return grade('alarm', _('HIGH TEMPERATURE (ALARM)'), _('High Alarm'));
			}
			if (temp <= th.temp_low_alarm) {
				return grade('alarm', _('LOW TEMPERATURE (ALARM)'), _('Low Alarm'));
			}
			if (temp >= th.temp_high_warn) {
				return grade('warn', _('HIGH TEMPERATURE (WARNING)'), _('High (Warning)'));
			}
			if (temp <= th.temp_low_warn) {
				return grade('warn', _('LOW TEMPERATURE (WARNING)'), _('Low (Warning)'));
			}
			return grade('optimal', _('NORMAL'), _('Optimal'));
		};

		var getVoltQuality = function(volt, th) {
			if (volt === null) {
				return grade('off', _('UNKNOWN'), _('Unknown'));
			}
			if (volt >= th.volt_high_alarm || volt <= th.volt_low_alarm) {
				return grade('alarm', _('SUPPLY VOLTAGE (ALARM)'), _('Alarm'));
			}
			if (volt >= th.volt_high_warn || volt <= th.volt_low_warn) {
				return grade('warn', _('MARGINAL VCC (WARNING)'), _('Warning'));
			}
			return grade('optimal', _('NORMAL VCC'), _('Optimal'));
		};

		var getBiasQuality = function(bias, tx, th) {
			if (bias === null) {
				return grade('off', _('UNKNOWN'), _('Unknown'));
			}
			/* A laser that is switched off legitimately draws no bias — that is not an alarm. */
			if (bias <= 0.0 || (tx !== null && tx <= LASER_OFF_DBM)) {
				return grade('off', _('STANDBY / LASER OFF'), _('Standby'));
			}
			if (bias >= th.bias_high_alarm || bias <= th.bias_low_alarm) {
				return grade('alarm', _('LASER BIAS (ALARM)'), _('Alarm'));
			}
			if (bias >= th.bias_high_warn || bias <= th.bias_low_warn) {
				return grade('warn', _('LASER BIAS (WARNING)'), _('Warning'));
			}
			return grade('optimal', _('NORMAL BIAS'), _('Optimal'));
		};

		// Circular Dial Generator
		var createDial = function(id, title) {
			var radius = 70;
			var circumference = 2 * Math.PI * radius;

			var svgContainer = E('div', {
				id: 'dial-svg-' + id,
				style: 'position:absolute; top:0; left:0; width:100%; height:100%; background:transparent !important;'
			});
			svgContainer.innerHTML = '<svg viewBox="0 0 160 160" style="background:transparent !important;">' +
				'<circle class="hw-dial-bg" cx="80" cy="80" r="' + radius + '"/>' +
				'<circle id="dial-prog-' + id + '" class="hw-dial-progress" cx="80" cy="80" r="' + radius + '" style="stroke: ' + SEVERITY_PALETTE.off.color + '; stroke-dasharray: 0 ' + circumference + ';"/>' +
				'</svg>';

			var dialBox = E('div', {
				class: 'hw-dial',
				style: 'background:transparent !important;'
			}, [
				svgContainer,
				E('div', { id: 'dial-txt-' + id, class: 'hw-dial-center' }, '--')
			]);

			var statusPill = E('div', {
				id: 'dial-pill-' + id,
				class: 'hw-status-pill',
				style: 'background: ' + SEVERITY_PALETTE.off.bg + '; color: ' + SEVERITY_PALETTE.off.color + ';'
			}, '--');

			var card = E('div', {
				class: 'hw-card',
				id: 'card-' + id
			}, [
				E('h3', { id: 'title-' + id }, title),
				E('div', { id: 'sub-' + id, class: 'hw-card-sub' }, '--'),
				dialBox,
				statusPill,
				E('div', { id: 'stats-' + id, class: 'hw-stats-list' })
			]);

			return {
				node: card,
				circ: circumference
			};
		};

		// 1. Top Row: 3 Primary Dials (RX, TX, Operating Temperature)
		var rxDial = createDial('rx', _('Received Optical Power (RX)'));
		var txDial = createDial('tx', _('Transmitted Optical Power (TX)'));
		var tempDial = createDial('temp', _('Operating Temperature'));

		container.appendChild(rxDial.node);
		container.appendChild(txDial.node);
		container.appendChild(tempDial.node);

		/* Small helper for the key/value rows in the informational cards. */
		var kv = function(key, id, extraClass) {
			return E('div', { class: 'hw-kv' }, [
				E('span', { class: 'hw-kv-k' }, key),
				E('span', { id: id, class: extraClass || 'hw-kv-v' }, '--')
			]);
		};

		/*
		 * 2. Middle rows: four cards, each confined to a single subsystem.
		 *
		 * The categories do not overlap. OMCI management (ITU-T G.988) covers the
		 * activation state machine and the managed-entity identity; the optical
		 * card covers only the BOSA and the laser; the Ethernet card covers only
		 * the host-side interface and its packet counters; and the module platform
		 * details that belong to none of those have their own card rather than
		 * being appended to whichever card had room.
		 */
		var kvStatic = function (key, value) {
			return E('div', { class: 'hw-kv' }, [
				E('span', { class: 'hw-kv-k' }, key),
				E('span', { class: 'hw-kv-v' }, value)
			]);
		};

		/* ONU management and activation, per ITU-T G.984.3 and G.988. Most of these
		 * attributes were already scraped but had nowhere to go. */
		var omciCard = E('div', { class: 'hw-card', style: 'align-items: stretch; justify-content: flex-start;' }, [
			E('h3', {}, _('OMCI Management')),
			E('div', { class: 'hw-card-sub' }, _('ONU management and control, per ITU-T G.988')),
			kv(_('ONU State:'), 'info-onu-state', 'hw-temp-badge'),
			kv(_('Activation State:'), 'info-reg-state'),
			kv(_('Registration:'), 'info-onu-reg'),
			kv(_('GPON Serial Number:'), 'info-sn'),
			kv(_('ONU Identifier:'), 'info-onu-id'),
			kv(_('OLT Vendor Identifier:'), 'info-olt-vendor'),
			kv(_('OMCI Vendor Identifier:'), 'info-vendor-id'),
			kv(_('OMCC Version:'), 'info-omcc'),
			kv(_('OMCI Software Image 1:'), 'info-omci-sw1'),
			kv(_('OMCI Software Image 2:'), 'info-omci-sw2'),
			kv(_('Organisationally Unique Identifier:'), 'info-oui'),
			kv(_('MAC Key Status:'), 'info-mackey')
		]);

		/* The optical transmitter and receiver assembly. Optical layer only. */
		var bosaCard = E('div', { class: 'hw-card', style: 'align-items: stretch; justify-content: flex-start;' }, [
			E('h3', {}, _('BOSA Laser & Optics')),
			E('div', { id: 'sub-bosa', class: 'hw-card-sub' }, '--'),
			kv(_('Optic Model:'), 'info-optic-part'),
			kv(_('Optic Vendor:'), 'info-optic-vendor'),
			kv(_('Optical Class:'), 'info-class'),
			kv(_('Transmit Wavelength:'), 'info-wl-tx'),
			kv(_('Receive Wavelength:'), 'info-wl-rx'),
			kvStatic(_('Interface Connector:'), _('Single-core, single-mode (SC)')),
			kv(_('Supply Voltage:'), 'info-vcc'),
			kv(_('Laser Bias Current:'), 'info-bias'),
			kv(_('Forward Error Correction:'), 'info-fec'),
			kv(_('Optical Alarms:'), 'info-alarms')
		]);

		/* Host-side Ethernet interface, and the PON and LAN packet counters. */
		var netCard = E('div', { class: 'hw-card', style: 'align-items: stretch; justify-content: flex-start;' }, [
			E('h3', {}, _('Ethernet & Packet Statistics')),
			E('div', { class: 'hw-card-sub' }, _('Host-side interface and traffic counters')),
			kv(_('LAN Interface:'), 'info-lan'),
			kv(_('WAN VLAN / PVID:'), 'info-vlan'),
			kv(_('MAC Address:'), 'info-mac'),
			kv(_('LAN Packets (RX / TX):'), 'info-pkts'),
			kv(_('PON Packets (RX / TX):'), 'info-pon-pkts'),
			kv(_('PON Bytes (RX / TX):'), 'info-pon-bytes'),
			kv(_('LAN Errors (RX / TX):'), 'info-errs'),
			kv(_('LAN Dropped (RX / TX):'), 'info-drops')
		]);

		/* Module platform details, which belong to none of the three subsystems. */
		var sysCard = E('div', { class: 'hw-card wide', style: 'align-items: stretch; justify-content: flex-start;' }, [
			E('h3', {}, _('System Information')),
			E('div', { class: 'hw-card-sub' }, _('Module platform and firmware')),
			E('div', { class: 'hw-kv-grid' }, [
				kv(_('Device Name:'), 'info-model'),
				kv(_('Firmware Version:'), 'info-fw'),
				kv(_('Hardware Revision:'), 'info-hw'),
				kv(_('CPU / RAM Load:'), 'info-load'),
				kv(_('System Uptime:'), 'info-uptime'),
				kv(_('Standards Compliance:'), 'info-compliance')
			])
		]);

		container.appendChild(omciCard);
		container.appendChild(bosaCard);
		container.appendChild(netCard);
		container.appendChild(sysCard);

		/* Build one row of the threshold matrix; every cell is populated from the payload. */
		var threshRow = function(label, prefix) {
			return E('tr', {}, [
				E('td', {}, E('strong', {}, label)),
				E('td', { id: 'th-' + prefix + '-val', style: 'font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;' }, '--'),
				E('td', { id: 'th-' + prefix + '-la' }, '--'),
				E('td', { id: 'th-' + prefix + '-lw' }, '--'),
				E('td', { id: 'th-' + prefix + '-hw' }, '--'),
				E('td', { id: 'th-' + prefix + '-ha' }, '--'),
				E('td', { id: 'th-' + prefix + '-status' }, E('span', {
					class: 'hw-temp-badge',
					style: 'background: ' + SEVERITY_PALETTE.off.bg + '; color: ' + SEVERITY_PALETTE.off.color + '; font-weight: 700;'
				}, _('Unknown')))
			]);
		};

		// 3. Third Row: Diagnostic Threshold Matrix & Alarms (Wide Card)
		var threshTable = E('table', { class: 'hw-table' }, [
			E('thead', {}, [
				E('tr', {}, [
					E('th', {}, _('Diagnostic Metric')),
					E('th', {}, _('Current Reading')),
					E('th', {}, _('Low Alarm')),
					E('th', {}, _('Low Warning')),
					E('th', {}, _('High Warning')),
					E('th', {}, _('High Alarm')),
					E('th', {}, _('Diagnostic Status'))
				])
			]),
			E('tbody', {}, [
				threshRow(_('Received Optical Power (RX)'), 'rx'),
				threshRow(_('Transmitted Optical Power (TX)'), 'tx'),
				threshRow(_('Operating Temperature'), 'temp'),
				threshRow(_('Supply Voltage (VCC)'), 'volt'),
				threshRow(_('Laser Bias Current'), 'bias')
			])
		]);

		var threshCard = E('div', { class: 'hw-card wide', style: 'align-items: stretch; margin-top: 5px;' }, [
			E('h3', {}, _('Diagnostic Threshold Limits & Status')),
			E('div', { id: 'sub-thresh', class: 'hw-card-sub' }, '--'),
			/* Seven columns never fit a phone; scroll the table, not the page. */
			E('div', { style: 'width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;' }, [threshTable])
		]);
		container.appendChild(threshCard);

		/* ---------------- OMCI managed entity cards --------------------- */
		container.appendChild(omciWrap);

		var OMCI_STATE_LEGEND = _('AdminState: 0 = unlocked, 1 = locked. OpState: 0 = enabled, 1 = disabled (ITU-T G.988).');

		var omciScalarGrid = function(inst) {
			var rows = [];
			for (var k in inst) {
				if (k === 'rules' || k === 'lines') continue;
				var v = inst[k];
				if (v === '' || v == null || v === '0x000000' || (k === 'DscpToPbitMapping' && (!v || v === '--'))) continue;

				/* Decode OltVendorId ASCII e.g. 0x414c434c -> ALCL (Alcatel-Lucent / Nokia) */
				if (k === 'OltVendorId') {
					var ascii = hexToAscii(inst[k]);
					if (ascii) {
						var vendorDesc = (ascii === 'ALCL') ? 'ALCL (Alcatel-Lucent / Nokia)' : (ascii === 'HWTC' ? 'HWTC (Huawei)' : (ascii === 'ZTEG' ? 'ZTEG (ZTE)' : ascii));
						v = vendorDesc + ' [' + inst[k] + ']';
					}
				}

				/* Decode AssociatedMePoint in ME 171 to human-readable interface */
				if (k === 'AssociatedMePoint') {
					var pointNum = parseInt(v, 16);
					if (!isNaN(pointNum)) {
						var ifName = '';
						if ((pointNum & 0x0100) !== 0) ifName = 'LAN Port ' + (pointNum & 0x00ff);
						else if ((pointNum & 0x0600) !== 0 || (pointNum & 0x0e00) !== 0) ifName = 'VEIP (Virtual Ethernet)';
						else if ((pointNum & 0x4000) !== 0) ifName = 'PPP Connection';
						else if ((pointNum & 0xff00) !== 0) ifName = 'POTS / Voice';
						if (ifName) v = v + ' (' + ifName + ')';
					}
				}

				rows.push(E('div', { class: 'hw-kv' }, [
					E('span', { class: 'hw-kv-k' }, k),
					E('span', { class: 'hw-kv-v' }, String(v))
				]));
			}
			return E('div', { class: 'hw-kv-grid' }, rows);
		};

		var omciRulesTable = function(rules) {
			return E('div', { class: 'hw-table-scroll' }, [
				E('table', { class: 'hw-omci-tbl' }, [
					E('thead', {}, [E('tr', {}, [
						E('th', {}, _('#')),
						E('th', {}, _('Filter Outer')),
						E('th', {}, _('Filter Inner')),
						E('th', {}, _('Treatment Outer')),
						E('th', {}, _('Treatment Inner'))
					])]),
					E('tbody', {}, rules.map(function(r) {
						return E('tr', {}, [
							E('td', { class: 'mono' }, r.index != null ? String(r.index) : '--'),
							E('td', { class: 'mono' }, r.filter_outer || '--'),
							E('td', { class: 'mono' }, r.filter_inner || '--'),
							E('td', { class: 'mono' }, r.treatment_outer || '--'),
							E('td', { class: 'mono' }, r.treatment_inner || '--')
						]);
					}))
				])
			]);
		};

		var renderOmciCards = function(payload, placeholder) {
			var me = (payload && payload.me) || {};

			omciWrap.innerHTML = '';

			OMCI_CARDS.forEach(function(spec) {
				var data = me[spec.id];
				var body;

				if (!data || !data.instances || !data.instances.length) {
					body = [E('div', { class: 'hw-omci-empty' },
						placeholder ? _('Not read yet') : _('No instances reported'))];
				} else {
					body = data.instances.map(function(inst) {
						var eid = inst.EntityID || inst.EntityId || '--';
						var kids = [
							E('div', { class: 'hw-omci-eid' }, _('Entity') + ' ' + eid),
							omciScalarGrid(inst)
						];
						if (inst.rules && inst.rules.length)
							kids.push(omciRulesTable(inst.rules));
						var validLines = (inst.lines || []).filter(function(line) {
							return line && !/^0x0+$/i.test(line.trim()) && line.trim() !== '0x000000';
						});
						if (validLines.length)
							kids.push(E('div', { class: 'hw-kv-grid' }, validLines.map(function(line) {
								return E('div', { class: 'hw-kv' }, [
									E('span', { class: 'hw-kv-v' }, line)
								]);
							})));
						return E('div', { class: 'hw-omci-inst' }, kids);
					});
				}

				var head = [
					E('h3', {}, spec.title + (data && data.name ? ' – ' + data.name : '')),
					E('div', { class: 'hw-card-sub' }, spec.sub)
				];
				var foot = (spec.id === '11' || spec.id === '329')
					? [E('p', { class: 'hw-actionbar-note' }, OMCI_STATE_LEGEND)]
					: [];

				omciWrap.appendChild(E('div', {
					class: spec.id === '171' ? 'hw-card wide' : 'hw-card half',
					style: 'align-items: stretch; justify-content: flex-start;'
				}, head.concat(body).concat(foot)));
			});
		};

		var omciLoaded = false;
		var loadOmci = function(force) {
			if (omciLoaded && !force)
				return;
			omciLoaded = true;

			omciBtn.disabled = true;
			setNote(_('Reading OMCI managed entities from the HSGQ SFP stick...'));

			callGetOmci().then(function(res) {
				res = res || {};
				renderOmciCards(res, false);
				setNote(res.success ? '' : (res.error || _('Could not read OMCI data from the stick.')),
				        res.success ? '' : '#e53935');
				omciBtn.disabled = false;
			}).catch(function(e) {
				setNote(_('OMCI read failed: ') + (e && e.message ? e.message : String(e)), '#e53935');
				omciBtn.disabled = false;
			});
		};

		renderOmciCards(null, true);
		loadOmci(false);

		/* Text setter that always writes, so a stale reading can never be left on screen. */
		var setTxt = function(id, val, color) {
			var el = document.getElementById(id);
			if (!el) return;
			el.textContent = (val === undefined || val === null || val === '') ? '--' : String(val);
			if (color) el.style.color = color;
		};

		var setTableVal = function(id, val, color) {
			setTxt(id, val, color);
		};

		var setStatusBadge = function(id, q) {
			var el = document.getElementById(id);
			if (!el) return;
			var isAlarm = (q.severity === 'alarm');
			var targetClass = 'hw-temp-badge' + (isAlarm ? ' hw-temp-crit' : '');
			var badgeEl = el.firstElementChild;

			if (!badgeEl || badgeEl.tagName !== 'SPAN') {
				badgeEl = document.createElement('span');
				badgeEl.className = targetClass;
				el.replaceChildren(badgeEl);
			} else if (badgeEl.className !== targetClass) {
				badgeEl.className = targetClass;
			}

			if (badgeEl.textContent !== q.badge) {
				badgeEl.textContent = q.badge;
			}
			badgeEl.style.color = q.color;
			/* Alarms hand their background over to the breathing animation. */
			badgeEl.style.background = isAlarm ? '' : q.bg;
			badgeEl.style.fontWeight = '700';
		};

		/* Percentage helper for the dial arcs, driven by the same thresholds. */
		var arcPct = function(v, lo, hi) {
			if (v === null || !isFinite(lo) || !isFinite(hi) || hi === lo) return 0;
			return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
		};

		/* Is a device-reported alarm field actually asserted? */
		var alarmAsserted = function(v) {
			if (v === null || v === undefined) return false;
			var s = String(v).trim().toLowerCase();
			if (!s) return false;
			if (s === '0' || s === 'no' || s === 'off' || s === 'clear' || s === 'normal' ||
			    s === 'none' || s === 'inactive' || s === 'ok') return false;
			return (s === '1' || s === 'yes' || s === 'on' ||
			        s.indexOf('alarm') !== -1 || s.indexOf('active') !== -1 ||
			        s.indexOf('assert') !== -1 || s.indexOf('fail') !== -1);
		};

		// Telemetry Update Function
		var updateDashboard = function(res) {
			res = (res && typeof res === 'object') ? res : {};

			var ok = (res.success !== false) && res.ddm && (typeof res.ddm === 'object');
			var ddm = ok ? res.ddm : {};
			var onu = (ok && res.onu && typeof res.onu === 'object') ? res.onu : {};
			var dev = (ok && res.device && typeof res.device === 'object') ? res.device : {};
			var mod = (ok && res.module && typeof res.module === 'object') ? res.module : {};
			var th  = buildThresholds(res);

			/* Report failures honestly: banner up, dials greyed, every badge 'off'. */
			if (ok) {
				banner.style.display = 'none';
				banner.textContent = '';
				container.classList.remove('hw-offline');
			} else {
				banner.textContent = _('Telemetry unavailable:') + ' ' +
					(res.error || res.message || _('the module returned no diagnostic data.'));
				banner.style.display = 'flex';
				container.classList.add('hw-offline');
			}

			var rx = toNum(ddm.rx_power_dbm);
			var tx = toNum(ddm.tx_power_dbm);
			var temp = toNum(ddm.temperature_c);
			var volt = toNum(ddm.voltage_v);
			var bias = toNum(ddm.bias_current_ma);

			var rxQ = getRxQuality(rx, th);
			var txQ = getTxQuality(tx, th, (ddm.tx_status || null));
			var tempQ = getTempQuality(temp, th);
			var voltQ = getVoltQuality(volt, th);
			var biasQ = getBiasQuality(bias, tx, th);

			// 1. RX Power Dial
			var rxTxt = document.getElementById('dial-txt-rx');
			var rxPill = document.getElementById('dial-pill-rx');
			var rxProg = document.getElementById('dial-prog-rx');
			var rxStats = document.getElementById('stats-rx');

			var rxDash = (arcPct(rx, th.rx_low_alarm - 5.0, th.rx_high_alarm) / 100) * rxDial.circ;

			if (rxTxt) {
				rxTxt.innerHTML = '';
				if (rx === null) {
					rxTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + rxQ.color + ';' }, '--'));
				} else if (self.unitSystem === 'dual') {
					var uwVal = toMicrowatts(rx);
					var uwFormatted = (uwVal < 1 ? uwVal.toFixed(2) : (uwVal >= 1000 ? (uwVal / 1000).toFixed(1) : uwVal.toFixed(1))) + (uwVal >= 1000 ? ' mW' : ' µW');
					rxTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + rxQ.color + ';' }, rx.toFixed(1) + ' dBm'));
					rxTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + rxQ.color + ';' }, uwFormatted));
				} else if (self.unitSystem === 'imperial') {
					var uw = toMicrowatts(rx);
					var uwSingle = (uw < 1 ? uw.toFixed(2) : (uw >= 1000 ? (uw / 1000).toFixed(2) : uw.toFixed(1))) + (uw >= 1000 ? ' mW' : ' µW');
					rxTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + rxQ.color + ';' }, uwSingle));
				} else {
					rxTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + rxQ.color + ';' }, rx.toFixed(1) + ' dBm'));
				}
			}

			if (rxPill) {
				rxPill.textContent = rxQ.label;
				rxPill.style.color = rxQ.color;
				rxPill.style.background = rxQ.bg;
			}

			if (rxProg) {
				rxProg.style.strokeDasharray = rxDash + ' ' + rxDial.circ;
				rxProg.style.stroke = rxQ.color;
			}

			setTxt('sub-rx', citationLabel(th, res));

			if (rxStats) {
				rxStats.innerHTML = '';
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Signal Quality:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + rxQ.color + '; font-weight: 700;' }, rxQ.badge)
				]));
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Calculated Power:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + rxQ.color + ';' }, fmtPower(rx))
				]));
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Usable Window:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + ACCENT_COLOR + ';' }, rangeText(th.rx_low_alarm, th.rx_high_alarm, 'dBm'))
				]));
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('RX Wavelength:')),
					E('span', { class: 'hw-stat-value' }, th.wavelength_rx_nm + ' nm')
				]));
			}

			// 2. TX Power Dial
			var txTxt = document.getElementById('dial-txt-tx');
			var txPill = document.getElementById('dial-pill-tx');
			var txProg = document.getElementById('dial-prog-tx');
			var txStats = document.getElementById('stats-tx');

			var txDash = ((tx === null || tx <= LASER_OFF_DBM) ? 0 : arcPct(tx, th.tx_low_alarm - 2.0, th.tx_high_alarm + 1.0) / 100) * txDial.circ;

			if (txTxt) {
				txTxt.innerHTML = '';
				if (tx === null) {
					txTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + txQ.color + ';' }, '--'));
				} else if (tx <= LASER_OFF_DBM) {
					txTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + txQ.color + '; font-size: 1.05em;' }, _('Laser Off')));
				} else if (self.unitSystem === 'dual') {
					var uwTx = toMicrowatts(tx);
					var uwTxFormatted = (uwTx < 1000 ? uwTx.toFixed(1) + ' µW' : (uwTx / 1000).toFixed(2) + ' mW');
					txTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + txQ.color + ';' }, (tx >= 0 ? '+' : '') + tx.toFixed(2) + ' dBm'));
					txTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + txQ.color + ';' }, uwTxFormatted));
				} else if (self.unitSystem === 'imperial') {
					var uwTxImp = toMicrowatts(tx);
					var uwTxSingle = (uwTxImp < 1000 ? uwTxImp.toFixed(1) + ' µW' : (uwTxImp / 1000).toFixed(2) + ' mW');
					txTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + txQ.color + ';' }, uwTxSingle));
				} else {
					txTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + txQ.color + ';' }, (tx >= 0 ? '+' : '') + tx.toFixed(2) + ' dBm'));
				}
			}

			if (txPill) {
				txPill.textContent = txQ.label;
				txPill.style.color = txQ.color;
				txPill.style.background = txQ.bg;
			}

			if (txProg) {
				txProg.style.strokeDasharray = txDash + ' ' + txDial.circ;
				txProg.style.stroke = txQ.color;
			}

			setTxt('sub-tx', citationLabel(th, res));

			if (txStats) {
				txStats.innerHTML = '';
				txStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Transmitter State:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + txQ.color + '; font-weight: 700;' }, txQ.badge)
				]));
				txStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Calculated Power:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + txQ.color + ';' }, (tx !== null && tx <= LASER_OFF_DBM) ? _('Laser Inactive') : fmtPower(tx))
				]));
				txStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Launch Power Range:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + ACCENT_COLOR + ';' }, rangeText(th.tx_low_alarm, th.tx_high_alarm, 'dBm'))
				]));
				txStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('TX Wavelength:')),
					E('span', { class: 'hw-stat-value' }, th.wavelength_tx_nm + ' nm')
				]));
			}

			// 3. Temperature Dial
			var tempTxt = document.getElementById('dial-txt-temp');
			var tempPill = document.getElementById('dial-pill-temp');
			var tempProg = document.getElementById('dial-prog-temp');
			var tempStats = document.getElementById('stats-temp');

			var tempDash = (arcPct(temp, 0, th.temp_high_alarm) / 100) * tempDial.circ;

			if (tempTxt) {
				tempTxt.innerHTML = '';
				if (self.unitSystem === 'dual') {
					var cVal = (temp === null) ? '--' : temp.toFixed(1) + ' °C';
					var fVal = (temp === null) ? '--' : toFahrenheit(temp).toFixed(1) + ' °F';
					tempTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + tempQ.color + ';' }, cVal));
					tempTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + tempQ.color + ';' }, fVal));
				} else if (self.unitSystem === 'imperial') {
					var fSingle = (temp === null) ? '--' : toFahrenheit(temp).toFixed(1) + ' °F';
					tempTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + tempQ.color + ';' }, fSingle));
				} else {
					var cSingle = (temp === null) ? '--' : temp.toFixed(1) + ' °C';
					tempTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + tempQ.color + ';' }, cSingle));
				}
			}

			if (tempPill) {
				tempPill.textContent = tempQ.label;
				tempPill.style.color = tempQ.color;
				tempPill.style.background = tempQ.bg;
			}

			if (tempProg) {
				tempProg.style.strokeDasharray = tempDash + ' ' + tempDial.circ;
				tempProg.style.stroke = tempQ.color;
			}

			setTxt('sub-temp', th.sff_citation);

			if (tempStats) {
				tempStats.innerHTML = '';
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Thermal Status:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + tempQ.color + '; font-weight: 700;' }, tempQ.badge)
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Temperature:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + tempQ.color + ';' }, fmtTemp(temp))
				]));
				/* Informational only, deliberately not used for grading. The reading
				 * above is the transceiver internal temperature reported over DDM,
				 * which normally sits above ambient; the datasheet figure is the
				 * module case/ambient rating. Grading an internal reading against an
				 * ambient rating would raise alarms that mean nothing. The alarm
				 * bands stay on SFF-8472, which is the standard written for DDM.
				 * HSGQ ships C-Temp and I-Temp variants and the module does not
				 * report which is fitted, so both are shown. */
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Rated Ambient Range:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + ACCENT_COLOR + ';' },
						_('0 °C to +70 °C (commercial) or −40 °C to +85 °C (industrial)'))
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Supply Voltage (VCC):')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + voltQ.color + ';' }, fmtVolt(volt))
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Laser Bias Current:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + biasQ.color + ';' }, fmtBias(bias))
				]));
			}

			// 4. Categorised Cards
			// Card 1: GPON & OMCI
			var rawState = (onu.state === null || onu.state === undefined) ? '' : String(onu.state).trim();
			var onuStateEl = document.getElementById('info-onu-state');
			if (onuStateEl) {
				if (!rawState) {
					onuStateEl.textContent = '--';
					onuStateEl.style.color = SEVERITY_PALETTE.off.color;
					onuStateEl.style.background = SEVERITY_PALETTE.off.bg;
				} else {
					var stateStr = rawState.toUpperCase();
					var stateNum = parseInt(stateStr.replace(/[^0-9]/g, ''), 10);
					var isO5 = (stateStr.indexOf('O5') !== -1);
					var stateSev = isO5 ? 'optimal' : ((!isNaN(stateNum) && stateNum >= 2) ? 'warn' : 'off');
					var stateP = SEVERITY_PALETTE[stateSev];
					onuStateEl.textContent = stateStr + (isO5 ? ' - ' + _('OPERATIONAL') : ((!isNaN(stateNum) && stateNum >= 2) ? ' - ' + _('SYNCHRONISING') : ' - ' + _('STANDBY')));
					onuStateEl.style.color = stateP.color;
					onuStateEl.style.background = stateP.bg;
				}
			}

			var isO5State = (rawState.toUpperCase().indexOf('O5') !== -1);

			setTxt('info-onu-reg', onu.registered_status);
			setTxt('info-sn', dev.gpon_sn);
			setTxt('info-fec', ddm.fec_status);

			/* Optical alarms are reported from the device flags plus the RX evaluation. */
			var alarmTxt = '--';
			var alarmColor = SEVERITY_PALETTE.off.color;
			if (ok) {
				var flags = [];
				if (rxQ.severity === 'alarm') {
					flags.push((rx !== null && rx > th.rx_high_alarm) ? _('Overload (LOS)') : _('LOS'));
				} else if (alarmAsserted(onu.alarm_los)) {
					flags.push(_('LOS'));
				}
				if (alarmAsserted(onu.alarm_lof)) flags.push(_('LOF'));
				if (alarmAsserted(onu.alarm_sf)) flags.push(_('SF'));
				if (alarmAsserted(onu.alarm_sd)) flags.push(_('SD'));

				if (flags.length) {
					alarmTxt = flags.join(', ');
					alarmColor = SEVERITY_PALETTE.alarm.color;
				} else if (rx === null) {
					alarmTxt = _('Unknown');
					alarmColor = SEVERITY_PALETTE.off.color;
				} else {
					alarmTxt = _('LOS / LOF / SF / SD: Clear');
					alarmColor = SEVERITY_PALETTE.optimal.color;
				}
			}
			setTxt('info-alarms', alarmTxt, alarmColor);

			setTxt('info-compliance', th.optical_citation + ' / ' + th.sff_citation);
			setTxt('info-omcc', dev.omcc_version);
			/* Managed-entity attributes the scraper already collected. They had no
			 * home while the card was shared with optical and Ethernet fields. */
			setTxt('info-onu-id', onu.onu_id);
			setTxt('info-olt-vendor', onu.olt_vendor);
			setTxt('info-vendor-id', dev.vendor_id);
			setTxt('info-omci-sw1', dev.omci_sw1);
			setTxt('info-omci-sw2', dev.omci_sw2);
			setTxt('info-oui', dev.oui);
			setTxt('info-mackey', onu.mackey_status);
			setTxt('info-reg-state', rawState ? (isO5State ? _('Operation State (O5)') : _('State') + ' ' + rawState.toUpperCase()) : null);

			// Card 2: Transceiver & BOSA Diagnostics
			setTxt('sub-bosa', th.optical_citation + ' / ' + th.sff_citation);
			setTxt('info-model', dev.device_name || mod.part_number);
			/* The optic identifies itself separately from the OMCI emulated identity. */
			setTxt('info-optic-part', mod.optic_part_number || mod.part_number);
			setTxt('info-optic-vendor', mod.optic_vendor || mod.vendor);
			setTxt('info-class', th.optical_citation);
			setTxt('info-wl-tx', th.wavelength_tx_nm + ' nm');
			setTxt('info-wl-rx', th.wavelength_rx_nm + ' nm');
			
			setTxt('info-vcc', fmtVolt(volt), voltQ.color);
			setTxt('info-bias', fmtBias(bias), biasQ.color);
			setTxt('info-hw', dev.hardware);

			// Card 3: Ethernet & Network Performance
			var lanEl = document.getElementById('info-lan');
			if (lanEl) {
				var lanStr = (dev.lan_status === null || dev.lan_status === undefined || dev.lan_status === '') ? null : String(dev.lan_status);
				lanEl.textContent = lanStr || '--';
				if (!lanStr) lanEl.style.color = SEVERITY_PALETTE.off.color;
				else if (/down|no link|unplug/i.test(lanStr)) lanEl.style.color = SEVERITY_PALETTE.alarm.color;
				else if (/up|link/i.test(lanStr)) lanEl.style.color = SEVERITY_PALETTE.optimal.color;
				else lanEl.style.color = SEVERITY_PALETTE.off.color;
			}

			setTxt('info-vlan', (dev.vlan_id === null || dev.vlan_id === undefined || dev.vlan_id === '') ? null : _('PVID') + ' ' + dev.vlan_id);

			var formattedMac = (dev.mac === null || dev.mac === undefined || dev.mac === '') ? null : String(dev.mac);
			if (formattedMac && formattedMac.indexOf(':') === -1 && formattedMac.length === 12) {
				formattedMac = formattedMac.match(/.{1,2}/g).join(':').toUpperCase();
			}
			setTxt('info-mac', formattedMac);

			var cpuUse = (dev.cpu_usage === null || dev.cpu_usage === undefined || dev.cpu_usage === '') ? null : String(dev.cpu_usage);
			var memUse = (dev.mem_usage === null || dev.mem_usage === undefined || dev.mem_usage === '') ? null : String(dev.mem_usage);
			setTxt('info-load', (cpuUse || memUse) ? ((cpuUse || '--') + ' / ' + (memUse || '--')) : null);

			setTxt('info-uptime', formatUptime(dev.uptime));
			setTxt('info-fw', dev.firmware);

			var lanRx = toNum(dev.lan_rx_pkts);
			var lanTx = toNum(dev.lan_tx_pkts);
			setTxt('info-pkts', (lanRx === null && lanTx === null) ? null :
				((lanRx === null ? '--' : lanRx) + ' / ' + (lanTx === null ? '--' : lanTx) + ' ' + _('pkts')));

			var ponRx = toNum(dev.pon_pkts_recv);
			var ponTx = toNum(dev.pon_pkts_sent);
			setTxt('info-pon-pkts', (ponRx === null && ponTx === null) ? null :
				((ponRx === null ? '--' : ponRx) + ' / ' + (ponTx === null ? '--' : ponTx) + ' ' + _('pkts')));

			/* Errors and drops are reported per direction rather than summed. A
			 * single total hides which direction is failing, which is the first
			 * thing worth knowing when a link misbehaves. */
			var countPair = function(id, rx, tx) {
				var el = document.getElementById(id);
				if (!el) return;
				var a = toNum(rx), b = toNum(tx);
				if (a === null && b === null) {
					el.textContent = '--';
					el.style.color = SEVERITY_PALETTE.off.color;
					return;
				}
				el.textContent = (a === null ? '--' : a.toLocaleString()) + ' / ' +
				                 (b === null ? '--' : b.toLocaleString());
				el.style.color = ((a || 0) > 0 || (b || 0) > 0)
					? SEVERITY_PALETTE.warn.color : SEVERITY_PALETTE.optimal.color;
			};
			countPair('info-errs', dev.lan_rx_err, dev.lan_tx_err);
			countPair('info-drops', dev.lan_rx_drop, dev.lan_tx_drop);

			/* PON byte counters, scraped all along but never rendered. */
			var fmtBytes = function(v) {
				var n = toNum(v);
				if (n === null) return '--';
				var u = ['B', 'kB', 'MB', 'GB', 'TB'], i = 0;
				while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
				return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
			};
			setTxt('info-pon-bytes',
				(toNum(dev.pon_bytes_recv) === null && toNum(dev.pon_bytes_sent) === null) ? null :
				(fmtBytes(dev.pon_bytes_recv) + ' / ' + fmtBytes(dev.pon_bytes_sent)));

			// 5. Threshold Matrix Table — every cell comes from the same payload as the badges
			setTxt('sub-thresh', _('Optical limits per') + ' ' + th.optical_citation + ' — ' +
				_('transceiver diagnostics per') + ' ' + th.sff_citation);

			setTableVal('th-rx-val', fmtPower(rx), rxQ.color);
			setTableVal('th-tx-val', (tx !== null && tx <= LASER_OFF_DBM) ? _('Laser Inactive') : fmtPower(tx), txQ.color);
			setTableVal('th-temp-val', fmtTemp(temp), tempQ.color);
			setTableVal('th-volt-val', fmtVolt(volt), voltQ.color);
			setTableVal('th-bias-val', fmtBias(bias), biasQ.color);

			setTxt('th-rx-la', fmtDbmLimit(th.rx_low_alarm));
			setTxt('th-rx-lw', fmtDbmLimit(th.rx_low_warn));
			setTxt('th-rx-hw', fmtDbmLimit(th.rx_high_warn));
			setTxt('th-rx-ha', fmtDbmLimit(th.rx_high_alarm));

			setTxt('th-tx-la', fmtDbmLimit(th.tx_low_alarm));
			setTxt('th-tx-lw', fmtDbmLimit(th.tx_low_warn));
			setTxt('th-tx-hw', fmtDbmLimit(th.tx_high_warn));
			setTxt('th-tx-ha', fmtDbmLimit(th.tx_high_alarm));

			setTxt('th-temp-la', fmtTemp(th.temp_low_alarm));
			setTxt('th-temp-lw', fmtTemp(th.temp_low_warn));
			setTxt('th-temp-hw', fmtTemp(th.temp_high_warn));
			setTxt('th-temp-ha', fmtTemp(th.temp_high_alarm));

			setTxt('th-volt-la', fmtVolt(th.volt_low_alarm));
			setTxt('th-volt-lw', fmtVolt(th.volt_low_warn));
			setTxt('th-volt-hw', fmtVolt(th.volt_high_warn));
			setTxt('th-volt-ha', fmtVolt(th.volt_high_alarm));

			setTxt('th-bias-la', fmtBias(th.bias_low_alarm));
			setTxt('th-bias-lw', fmtBias(th.bias_low_warn));
			setTxt('th-bias-hw', fmtBias(th.bias_high_warn));
			setTxt('th-bias-ha', fmtBias(th.bias_high_alarm));

			setStatusBadge('th-rx-status', rxQ);
			setStatusBadge('th-tx-status', txQ);
			setStatusBadge('th-temp-status', tempQ);
			setStatusBadge('th-volt-status', voltQ);
			setStatusBadge('th-bias-status', biasQ);
		};

		// Initial render populate
		updateDashboard(initialStatus);

		// Standard LuCI Native Polling System
		poll.add(function() {
			return callGetStatus().then(function(res) {
				updateDashboard(res);
			}).catch(function(err) {
				updateDashboard({ success: false, error: (err && err.message) ? err.message : String(err) });
			});
		}, pollInterval);

		return container;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
