#!/usr/bin/env bash
# Full-journey smoke test against a deployed TaskFlow.
# Usage:
#   BASE=https://your.domain.tld ./scripts/smoke-prod.sh
#
# Exits non-zero on any failure. Creates a unique test user per run; does not
# attempt to clean up (adds one user + one org to the prod DB per invocation).
# Safe against prod because it only creates new tenant data, never touches
# existing records.

set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
BASE="${BASE%/}"  # strip trailing slash — otherwise `$BASE/api/...` becomes `//api/...`
STAMP=$(date +%s)
EMAIL="smoke+${STAMP}@taskflow.test"
PASSWORD="correct-horse-battery-staple-${STAMP}"
ORG_SLUG="smoke-${STAMP}"
PROJECT_KEY="S${STAMP: -4}"

section() { printf '\n\033[1;33m=== %s ===\033[0m\n' "$1"; }
ok() { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[1;31m✗\033[0m %s\n' "$1"; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing dependency: $1"; exit 1; }
}
require curl
require jq

# ----- signup
section "signup"
signup=$(curl -sSf -X POST "$BASE/api/auth/signup" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke ${STAMP}\"}")
access=$(echo "$signup" | jq -r .accessToken)
refresh=$(echo "$signup" | jq -r .refreshToken)
user_id=$(echo "$signup" | jq -r .user.id)
[ -n "$access" ] && [ "$access" != "null" ] || fail "no accessToken in signup"
ok "signed up as $EMAIL (user_id=$user_id)"

# ----- /api/me
section "/api/me with access token"
me=$(curl -sSf "$BASE/api/me" -H "authorization: Bearer $access")
echo "$me" | jq -e '.user.email == "'"$EMAIL"'"' > /dev/null || fail "/api/me did not echo user"
ok "/api/me returns user; orgs=[]"

# ----- create org (bootstrap, withAdminTx path)
section "create organization"
org=$(curl -sSf -X POST "$BASE/api/orgs" \
  -H "authorization: Bearer $access" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke Org ${STAMP}\",\"slug\":\"$ORG_SLUG\"}")
org_id=$(echo "$org" | jq -r .id)
[ "$(echo "$org" | jq -r .role)" = "OWNER" ] || fail "creator should be OWNER"
ok "org created (id=$org_id)"

# ----- create project (hits RLS-protected INSERT, needs user_id session var)
section "create project"
project=$(curl -sSf -X POST "$BASE/api/orgs/$org_id/projects" \
  -H "authorization: Bearer $access" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke Project\",\"key\":\"$PROJECT_KEY\"}")
project_id=$(echo "$project" | jq -r .id)
[ -n "$project_id" ] && [ "$project_id" != "null" ] || fail "no project id"
ok "project created (key=$PROJECT_KEY)"

# ----- create task
section "create task"
task=$(curl -sSf -X POST "$BASE/api/projects/$project_id/tasks" \
  -H "authorization: Bearer $access" \
  -H 'content-type: application/json' \
  -d '{"title":"First task from smoke"}')
task_id=$(echo "$task" | jq -r .id)
[ "$(echo "$task" | jq -r .number)" = "1" ] || fail "task number should be 1"
ok "task created (id=$task_id)"

# ----- list tasks (proves RLS USING predicate admits own data)
section "list project tasks"
tasks=$(curl -sSf "$BASE/api/projects/$project_id/tasks" -H "authorization: Bearer $access")
count=$(echo "$tasks" | jq 'length')
[ "$count" = "1" ] || fail "expected 1 task, got $count"
ok "list shows the task we created"

# ----- export CSV (proves core-api → analytics inter-service call + streaming)
section "export CSV (core-api → analytics)"
# Python's csv.writer emits CRLF line endings (RFC 4180). Strip \r for shell comparison.
csv=$(curl -sSf "$BASE/api/projects/$project_id/export.csv" -H "authorization: Bearer $access" | tr -d '\r')
header=$(echo "$csv" | head -1)
expected_header="key,title,status,priority,due_date,reporter,assignee,created_at,updated_at"
[ "$header" = "$expected_header" ] || fail "unexpected CSV header: $header"
rows=$(echo "$csv" | tail -n +2 | wc -l | tr -d ' ')
[ "$rows" = "1" ] || fail "expected 1 data row, got $rows"
echo "$csv" | grep -q 'First task from smoke' || fail "task title missing from CSV"
ok "analytics returned correct CSV for this tenant"

# ----- refresh rotation + reuse detection
section "refresh rotation"
refreshed=$(curl -sSf -X POST "$BASE/api/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$refresh\"}")
new_access=$(echo "$refreshed" | jq -r .accessToken)
new_refresh=$(echo "$refreshed" | jq -r .refreshToken)
[ "$new_refresh" != "$refresh" ] || fail "refresh did not rotate"
ok "new access + new refresh issued"

section "reuse of rotated refresh → 401"
reuse_code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$refresh\"}")
[ "$reuse_code" = "401" ] || fail "expected 401 on reuse, got $reuse_code"
ok "reuse detected"

section "family revoked (new_refresh also dead)"
family_code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$new_refresh\"}")
[ "$family_code" = "401" ] || fail "expected 401 on family-revoked refresh, got $family_code"
ok "family revoke enforced"

# ----- fresh login after family revoke
section "fresh login"
login=$(curl -sSf -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
final_refresh=$(echo "$login" | jq -r .refreshToken)
[ -n "$final_refresh" ] && [ "$final_refresh" != "null" ] || fail "login did not return refresh"
ok "login works after family revoke"

# ----- logout
section "logout revokes current refresh"
logout_code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/logout" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$final_refresh\"}")
[ "$logout_code" = "204" ] || fail "expected 204 on logout, got $logout_code"
after_code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$final_refresh\"}")
[ "$after_code" = "401" ] || fail "expected 401 after logout, got $after_code"
ok "logout invalidates refresh"

printf '\n\033[1;32m%s\033[0m\n' "All checks passed against $BASE"
printf 'Test tenant left behind: user=%s org=%s\n' "$EMAIL" "$ORG_SLUG"
