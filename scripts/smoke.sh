#!/usr/bin/env bash
# End-to-end smoke test against a RUNNING stack, through the same front door a browser uses.
# Usage: scripts/smoke.sh [base-url]     (default http://localhost:8080)
set -euo pipefail
BASE="${1:-http://localhost:8080}"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
json() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1], {'d': d}))" "$1"; }
call() { curl -fsS -H 'Content-Type: application/json' "$@"; }

echo "-> front door serves the SPA with security headers"
headers=$(curl -fsS -D - -o /dev/null "$BASE/")
grep -qi '^content-security-policy:' <<<"$headers" || fail "no CSP on /"
grep -qi '^x-content-type-options: nosniff' <<<"$headers" || fail "no nosniff on /"

echo "-> API is ready"
call "$BASE/api/health/ready" >/dev/null || fail "readiness"

EMAIL="smoke-$(date +%s)-$RANDOM@example.test"
PASS="smoke-passphrase-$RANDOM-$RANDOM"
echo "-> register a workspace"
session=$(call -X POST "$BASE/api/auth/register" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Smoke\",\"tenantName\":\"Smoke Co\",\"niche\":\"restaurant\"}")
token=$(json "d['accessToken']" <<<"$session")
auth=(-H "Authorization: Bearer $token")
[ "$(json "d['tenant']['niche']" <<<"$session")" = "restaurant" ] || fail "niche not stored"

echo "-> create and read a resource"
rid=$(call "${auth[@]}" -X POST "$BASE/api/resources" -d '{"name":"Smoke item","data":{"notes":"hello"}}' | json "d['id']")
call "${auth[@]}" "$BASE/api/resources/$rid" | json "d['name']" | grep -q 'Smoke item' || fail "read back"

echo "-> an unauthenticated call is refused"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/resources")
[ "$code" = "401" ] || fail "expected 401, got $code"

echo "-> invoice: idempotent create, issue, pay exactly once"
key=$(python3 -c 'import uuid; print(uuid.uuid4())')
body='{"currency":"USD","lines":[{"description":"Tea","quantity":2,"unitPrice":"4.50"}]}'
inv1=$(call "${auth[@]}" -H "Idempotency-Key: $key" -X POST "$BASE/api/invoices" -d "$body")
inv2=$(call "${auth[@]}" -H "Idempotency-Key: $key" -X POST "$BASE/api/invoices" -d "$body")
iid=$(json "d['id']" <<<"$inv1")
[ "$iid" = "$(json "d['id']" <<<"$inv2")" ] || fail "idempotent replay created a second invoice"
[ "$(json "d['totalCents']" <<<"$inv1")" = "900" ] || fail "total should be 900 cents"
call "${auth[@]}" -X POST "$BASE/api/invoices/$iid/issue" >/dev/null
pkey=$(python3 -c 'import uuid; print(uuid.uuid4())')
call "${auth[@]}" -H "Idempotency-Key: $pkey" -X POST "$BASE/api/invoices/$iid/payments" -d '{"amount":"9.00"}' >/dev/null
status=$(call "${auth[@]}" "$BASE/api/invoices/$iid" | json "d['status']")
[ "$status" = "paid" ] || fail "invoice should be paid, is $status"
over=$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" -H 'Content-Type: application/json' -H "Idempotency-Key: $(python3 -c 'import uuid; print(uuid.uuid4())')" -X POST "$BASE/api/invoices/$iid/payments" -d '{"amount":"0.01"}')
[ "$over" = "409" ] || [ "$over" = "422" ] || fail "paying a settled invoice must be refused (got $over)"

echo "-> webhook targets: private and non-existent hosts are refused with a 400, never a 500"
code=$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/webhook-endpoints" -d '{"url":"http://169.254.169.254/latest/meta-data"}')
[ "$code" = "400" ] || fail "metadata address should be refused with 400, got $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "${auth[@]}" -H 'Content-Type: application/json' -X POST "$BASE/api/webhook-endpoints" -d '{"url":"https://hooks.example.invalid/in"}')
[ "$code" = "400" ] || fail "unresolvable host should be refused with 400, got $code"

echo "-> the separate worker process picks up outbox events"
# 203.0.113.0/24 is a documentation range: public as far as the SSRF guard is concerned, but nothing answers.
# Whatever the network does (timeout, unreachable), the worker must claim the event and record the attempt.
eid=$(call "${auth[@]}" -X POST "$BASE/api/webhook-endpoints" -d '{"url":"https://203.0.113.7/hook"}' | json "d['id']")
call "${auth[@]}" -X POST "$BASE/api/resources" -d '{"name":"Triggers an event"}' >/dev/null
attempts=0
for _ in $(seq 1 30); do
  attempts=$(call "${auth[@]}" "$BASE/api/webhook-endpoints/$eid/deliveries" | json "max([x['attempts'] for x in d] or [0])")
  [ "$attempts" -ge 1 ] && break
  sleep 1
done
[ "$attempts" -ge 1 ] || fail "no delivery attempt recorded: is the worker running?"

echo "-> the audit chain verifies"
[ "$(call "${auth[@]}" "$BASE/api/audit/verify" | json "d['valid']")" = "True" ] || fail "audit chain invalid"

echo "-> the websocket handshake is proxied (polling transport)"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/socket.io/?EIO=4&transport=polling")
[ "$code" = "200" ] || fail "socket.io handshake returned $code"

echo "SMOKE OK"
