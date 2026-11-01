#!/usr/bin/env bash
# Mutation check by hand: break one critical invariant at a time and require the matching spec to go RED.
# A suite that stays green on a broken invariant proves nothing. Needs the shared test Postgres (TEST_DATABASE_URL).
#   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:25433/app scripts/sabotage.sh
set -uo pipefail
cd "$(dirname "$0")/.."
: "${TEST_DATABASE_URL:?set TEST_DATABASE_URL}"

before=$(find src -type f -name '*.ts' -print0 | sort -z | xargs -0 sha256sum | sha256sum)
survivors=0

# usage: mutant "<name>" <file> "<old>" "<new>" <spec>
mutant() {
  local name="$1" file="$2" old="$3" new="$4" spec="$5" backup
  backup=$(mktemp)
  cp "$file" "$backup"
  if ! python3 - "$file" "$old" "$new" <<'PY'
import sys, pathlib
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = pathlib.Path(path).read_text()
if text.count(old) != 1:
    sys.exit(f"pattern must occur exactly once in {path}, found {text.count(old)}")
pathlib.Path(path).write_text(text.replace(old, new))
PY
  then echo "  [setup error] $name"; cp "$backup" "$file"; rm "$backup"; survivors=$((survivors + 1)); return; fi
  local out; out=$(timeout 300 npx jest --selectProjects e2e --runInBand "$spec" 2>&1 | grep -E "^Tests:" | tail -1)
  cp "$backup" "$file"; rm "$backup"
  if grep -q "failed" <<<"$out"; then echo "  killed    $name   ($out)"
  else echo "  SURVIVED  $name   ($out)"; survivors=$((survivors + 1)); fi
}

echo "mutants (each must be killed):"
mutant "overpay check removed from the payment UPDATE"  src/modules/billing/billing.service.ts "AND paid_cents + \$3 <= total_cents" "AND true" test/billing.e2e-spec.ts
mutant "idempotency advisory lock removed"              src/modules/idempotency/idempotency.service.ts "SELECT pg_advisory_xact_lock(hashtextextended(\$1, 0))" "SELECT pg_advisory_xact_lock(hashtextextended(\$1, 0)) WHERE false" test/idempotency.e2e-spec.ts
mutant "audit append lock removed"                      src/modules/audit/audit.service.ts "SELECT pg_advisory_xact_lock(hashtextextended(\$1, 0))" "SELECT pg_advisory_xact_lock(hashtextextended(\$1, 0)) WHERE false" test/audit.e2e-spec.ts
mutant "refresh-token row lock removed"                 src/modules/identity/identity.service.ts "WHERE token_hash = \$1 FOR UPDATE'" "WHERE token_hash = \$1'" test/auth.e2e-spec.ts
mutant "SSRF literal-IP check disabled"                 src/modules/outbox/http-post.ts "if (!options.allowPrivate && isIP(literal) && isPrivateAddress(literal)) {" "if (false) {" test/outbox.e2e-spec.ts
mutant "route loses its @Roles (deny-by-default)"       src/modules/audit/audit.controller.ts $'@Roles(...ADMINS)\n  list(' $'list(' test/tenancy.e2e-spec.ts

# the runtime role must never be able to bypass row level security: break the migrator that guarantees it
psql_owner() { docker exec -i showcase-pg psql -U postgres -d app -q "$@"; }
mutant "migrator stops forbidding BYPASSRLS on the runtime role" src/database/migrator.ts "NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS" "NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS" test/tenancy.e2e-spec.ts
psql_owner -c "ALTER ROLE app_user NOBYPASSRLS" >/dev/null   # the mutant ran against the shared database: put the role back

after=$(find src -type f -name '*.ts' -print0 | sort -z | xargs -0 sha256sum | sha256sum)
[ "$before" = "$after" ] && echo "source tree restored byte-for-byte" || { echo "SOURCE TREE CHANGED, restore manually"; exit 2; }
echo "survivors: $survivors"
exit "$survivors"
