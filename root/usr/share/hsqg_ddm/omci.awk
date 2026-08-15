# Parse OMCI data (both omcicli text/HTML and Boa ASP pages) for HSGQ Realtek SFP Stick into JSON.
# Runs under gawk, mawk and BusyBox awk.

function clean(s,   i, c, out) {
	out = ""
	for (i = 1; i <= length(s); i++) {
		c = substr(s, i, 1)
		out = out (index(PRINTABLE, c) > 0 ? c : " ")
	}
	return out
}

function esc(s) {
	s = trim(clean(s))
	gsub(/\\/, "\\\\", s)
	gsub(/"/, "\\\"", s)
	return s
}

function trim(s) {
	sub(/^[ \t]+/, "", s)
	sub(/[ \t]+$/, "", s)
	return s
}

function flush_instance(   i, n, out, first) {
	if (!fcount && !rcount && !lcount)
		return
	n = icount[me]++
	out = "{"
	first = 1
	for (i = 0; i < fcount; i++) {
		if (!first) out = out ","
		out = out "\"" esc(fkey[i]) "\":\"" esc(fval[i]) "\""
		first = 0
	}
	if (rcount) {
		if (!first) out = out ","
		out = out "\"rules\":[" rules "]"
		first = 0
	}
	if (lcount) {
		if (!first) out = out ","
		out = out "\"lines\":[" lines "]"
		first = 0
	}
	out = out "}"
	inst[me, n] = out
	fcount = 0
	rcount = 0
	lcount = 0
	rules = ""
	lines = ""
	rule_open = 0
}

function close_rule() {
	if (!rule_open)
		return
	if (rcount++) rules = rules ","
	rules = rules "{" rule "}"
	rule = ""
	rule_open = 0
}

function add_field(k, v) {
	fkey[fcount] = k
	fval[fcount] = v
	fcount++
}

function add_rule_field(k, v) {
	if (rule != "") rule = rule ","
	rule = rule "\"" esc(k) "\":\"" esc(v) "\""
	rule_open = 1
}

BEGIN {
	PRINTABLE = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
	me = ""
	fcount = 0
	rcount = 0
	lcount = 0
	banner = 0
}

# Section markers
/^===SECTION:[0-9]+===/ {
	close_rule()
	flush_instance()
	line = $0
	sub(/^===SECTION:/, "", line)
	sub(/===.*$/, "", line)
	me = line
	seen[me] = 1
	if (!(me in icount)) icount[me] = 0
	next
}

/^=+$/ {
	close_rule()
	flush_instance()
	next
}

# ME 171 repeating table: a new INDEX starts a new rule object.
/^[ \t]*INDEX[ \t]+[0-9]+/ {
	close_rule()
	line = trim($0)
	sub(/^INDEX[ \t]+/, "", line)
	add_rule_field("index", line)
	next
}

# Filter / Treatment rows belong to the rule opened by the preceding INDEX.
/^[ \t]*(Filter|Treatment)[ \t]+(Outer|Inner)[ \t]*:/ {
	line = trim($0)
	key = line
	sub(/[ \t]*:.*$/, "", key)
	gsub(/[ \t]+/, "_", key)
	val = line
	sub(/^[^:]*:[ \t]*/, "", val)
	add_rule_field(tolower(key), trim(val))
	next
}

# ME 84 filter rows repeat with a bracketed index
/^[ \t]*FilterTbl\[[0-9]+\][ \t]*:/ {
	line = trim($0)
	key = line
	sub(/[ \t]*:.*$/, "", key)
	val = line
	sub(/^[^:]*:[ \t]*/, "", val)
	add_field(key, trim(val))
	next
}

# Indented continuation lines. Filter out 0x000000 padding.
/^[ \t]+[^ \t]/ {
	if (me == "")
		next
	val = trim($0)
	if (val == "" || val ~ /^0x0+$/ || val ~ /^0+$/)
		next
	if (lcount++) lines = lines ","
	lines = lines "\"" esc(val) "\""
	next
}

# Plain "Key: Value".
/^[A-Za-z][A-Za-z0-9_]*[ \t]*:/ {
	if (me == "")
		next
	key = $0
	sub(/[ \t]*:.*$/, "", key)
	val = $0
	sub(/^[^:]*:[ \t]*/, "", val)
	add_field(trim(key), trim(val))
	next
}

END {
	close_rule()
	flush_instance()

	mename["11"] = "EthUni"
	mename["84"] = "VlanTagFilterData"
	mename["131"] = "OltG"
	mename["171"] = "ExtVlanTagOperCfgData"
	mename["256"] = "OntG"
	mename["329"] = "VEIP"

	printf("{\"success\":true,\"connected\":true,\"host\":\"%s\",\"timestamp\":%s,\"me\":{", esc(host), ts)
	firstme = 1
	nclasses = split(classes, want, ",")
	for (c = 1; c <= nclasses; c++) {
		k = trim(want[c])
		if (k == "" || !(k in seen))
			continue
		if (!firstme) printf(",")
		printf("\"%s\":{\"name\":\"%s\",\"instances\":[", esc(k), esc(mename[k]))
		for (j = 0; j < icount[k]; j++) {
			if (j) printf(",")
			printf("%s", inst[k, j])
		}
		printf("]}")
		firstme = 0
	}
	printf("}}\n")
}
