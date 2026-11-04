#!/usr/bin/env bash
# Edits the audit trail behind the application's back, on purpose, in a throwaway workspace it creates itself, and shows
# that the edit is noticed. Needs the Compose stack (`make up`), curl, python3 and Docker; nothing else is touched.
#   scripts/tamper-demo.sh [base-url]      (default http://localhost:8080)
# Exits non-zero if the tampering is NOT detected, so CI can run it as a test.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="${1:-http://localhost:${WEB_PORT:-8080}}"
fail() { echo "TAMPER DEMO FAIL: $*" >&2; exit 1; }
say() { printf '\n\033[2m# %s\033[0m\n' "$*"; }
shell() { printf '\033[1m$ %s\033[0m\n' "$*"; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
call() { curl -fsS -H 'Content-Type: application/json' "$@"; }
sql_owner() { docker compose exec -T db psql -U postgres -d app -v ON_ERROR_STOP=0 -X -q "$@" 2>&1; }

EMAIL="tamper-$(date +%s)-$RANDOM@example.test"
PASS="tamper-passphrase-$RANDOM-$RANDOM"
session=$(call -X POST "$BASE/api/auth/register" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Tamper Demo\",\"tenantName\":\"Tamper Demo Co\",\"niche\":\"legal\"}")
token=$(json "d['accessToken']" <<<"$session")
tenant=$(json "d['tenant']['id']" <<<"$session")
auth=(-H "Authorization: Bearer $token")
uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }

say "A throwaway workspace ($tenant) issues an invoice and takes a payment of 10.00. Each step is a row in its audit trail."
inv=$(call "${auth[@]}" -H "Idempotency-Key: $(uuid)" -X POST "$BASE/api/invoices" -d '{"currency":"USD","lines":[{"description":"Retainer","quantity":1,"unitPrice":"10.00"}]}' | json "d['id']")
call "${auth[@]}" -X POST "$BASE/api/invoices/$inv/issue" >/dev/null
call "${auth[@]}" -H "Idempotency-Key: $(uuid)" -X POST "$BASE/api/invoices/$inv/payments" -d '{"amount":"10.00"}' >/dev/null

shell "GET /api/audit/verify"
call "${auth[@]}" "$BASE/api/audit/verify"; echo
[ "$(call "${auth[@]}" "$BASE/api/audit/verify" | json "d['valid']")" = "True" ] || fail "a fresh chain should verify"
seq=$(call "${auth[@]}" "$BASE/api/audit?limit=50" | json "[e['seq'] for e in d['items'] if e['action'] == 'payment.recorded'][0]")

say "Someone with the database owner's role tries to make the payment look like 1.00."
edit="UPDATE audit_logs SET metadata = '{\"amountCents\": 100}' WHERE tenant_id = '$tenant' AND seq = $seq;"
shell "psql -U postgres -d app -c \"$edit\""
out=$(sql_owner -c "$edit" || true); echo "$out"
grep -q 'append-only' <<<"$out" || fail "the trigger should have refused the update"

say "So they switch the guard off, edit, and switch it back on."
shell "ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable;  (then the same UPDATE, then ENABLE)"
sql_owner -c "ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_immutable;" -c "$edit" -c "ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_immutable;"

say "The application does not trust the table; it checks the chain."
shell "GET /api/audit/verify"
after=$(call "${auth[@]}" "$BASE/api/audit/verify"); echo "$after"
[ "$(json "d['valid']" <<<"$after")" = "False" ] || fail "the edit was not detected"
[ "$(json "d['broken']['seq']" <<<"$after")" = "$seq" ] || fail "the wrong row was named"
say "Detected: row #$seq, $(json "d['broken']['reason']" <<<"$after"). The workspace is left as it is; it is a throwaway."
