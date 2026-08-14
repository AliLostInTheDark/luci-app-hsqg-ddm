'use strict';
'require view';
'require form';
'require rpc';
'require ui';

var callTestConnection = rpc.declare({
	object: 'hsqg_ddm',
	method: 'test_connection',
	expect: {}
});

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('hsqg_ddm', _('HSGQ SFP DDM Settings'),
			_('Configure connection parameters and unit display settings for the HSGQ SFP module residing in the media converter.'));

		s = m.section(form.NamedSection, 'main', 'hsqg_ddm', _('Connection Parameters'));
		s.anonymous = true;

		o = s.option(form.Flag, 'enabled', _('Enable Monitoring'),
			_('Enable or disable live DDM telemetry collection from the HSGQ SFP module.'));
		o.default = o.enabled;
		o.rmempty = false;

		o = s.option(form.Value, 'host', _('Module IP Address'),
			_('The IP address of the HSGQ SFP module inside the media converter.'));
		o.datatype = 'ip4addr';
		o.default = '192.168.150.1';
		o.rmempty = false;

		o = s.option(form.ListValue, 'proto', _('Protocol'),
			_('Diagnostic management protocol exposed by the module.'));
		o.value('http', 'HTTP (Boa Web API - Recommended)');
		o.value('telnet', 'Telnet');
		o.value('ssh', 'SSH');
		o.default = 'http';

		o = s.option(form.Value, 'port', _('Port'),
			_('Connection port on the SFP module (usually 80 for HTTP, 23 for Telnet, 22 for SSH).'));
		o.datatype = 'port';
		o.default = '80';
		o.rmempty = false;

		o = s.option(form.Value, 'username', _('Username'),
			_('Login username for the module.'));
		o.default = 'admin';
		o.rmempty = false;

		o = s.option(form.Value, 'password', _('Password'),
			_('Login password for the module.'));
		o.password = true;
		o.default = 'Admin@1234567890';
		o.rmempty = false;

		o = s.option(form.ListValue, 'unit_system', _('Measurement Unit System'),
			_('Select default units for temperature and optical power values across the dashboard.'));
		o.value('dual', _('Dual Display (°C / °F, dBm / µW) - Recommended'));
		o.value('metric', _('Metric System (°C, dBm)'));
		o.value('imperial', _('Imperial System (°F, µW)'));
		o.default = 'dual';

		o = s.option(form.ListValue, 'poll_interval', _('Polling Interval'),
			_('Frequency of live DDM telemetry collection.'));
		o.value('2', _('2 Seconds (High Resolution)'));
		o.value('3', _('3 Seconds (Recommended)'));
		o.value('5', _('5 Seconds'));
		o.value('10', _('10 Seconds (Low CPU overhead)'));
		o.default = '3';

		o = s.option(form.Value, 'timeout', _('Connection Timeout (Seconds)'),
			_('Maximum time in seconds to wait for a response from the SFP module.'));
		o.datatype = 'uinteger';
		o.default = '3';

		// Test Connection Section
		s = m.section(form.NamedSection, 'main', 'hsqg_ddm', _('Connectivity Test'));
		s.anonymous = true;

		o = s.option(form.Button, '_test_btn', _('Test Connection'),
			_('Test connection and authentication to the HSGQ module using the currently saved settings.'));
		o.inputtitle = _('Test Now');
		o.inputstyle = 'action';
		o.onclick = function(ev) {
			ui.showModal(_('Testing Connection...'), [
				E('p', { 'class': 'spinning' }, _('Attempting to connect and query HSGQ SFP module...'))
			]);

			return callTestConnection().then(function(res) {
				ui.hideModal();
				if (res && res.connected) {
					ui.addNotification(null, E('p', { 'style': 'color: #10b981; font-weight: bold;' },
						_('Success: ') + res.message
					), 'info');
				} else {
					ui.addNotification(null, E('p', { 'style': 'color: #ef4444; font-weight: bold;' },
						_('Error: ') + (res && res.message ? res.message : _('Unable to connect to module.'))
					), 'danger');
				}
			}).catch(function(err) {
				ui.hideModal();
				ui.addNotification(null, E('p', { 'style': 'color: #ef4444;' },
					_('RPC Error: ') + (err.message || err)
				), 'danger');
			});
		};

		return m.render();
	}
});
