#!/usr/bin/env bash
# Manual smoke test for refresh-token flow.
# Run against a local core-api. Set BASE if not http://localhost:3001.
# Requires `jq`. Tears down its test user via DB if you want a clean slate.

set -euo pipefail

BASE="${BASE:-http://localhost:3001}"
EMAIL="smoke+$(date +%s)@taskflow.test"
PASSWORD="password1234"

section() { printf '\n\033[1;33m=== %s ===\033[0m\n' "$1"; }
ok() { printf '  \033[1;32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[1;31m✗\033[0m %s\n' "$1"; exit 1; }

section "signup"
signup=$(curl -sS -X POST "$BASE/api/auth/signup" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Smoke Test\"}")
access1=$(echo "$signup" | jq -r .accessToken)
refresh1=$(echo "$signup" | jq -r .refreshToken)
[ -n "$access1" ] && [ "$access1" != "null" ] || fail "no accessToken in signup response"
[ -n "$refresh1" ] && [ "$refresh1" != "null" ] || fail "no refreshToken in signup response"
ok "got access + refresh"

section "access token works on /api/me"
me=$(curl -sS "$BASE/api/me" -H "authorization: Bearer $access1")
echo "$me" | jq -e .user.email > /dev/null || fail "/api/me did not return user"
ok "/api/me returned user"

section "refresh rotates tokens"
refreshed=$(curl -sS -X POST "$BASE/api/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$refresh1\"}")
access2=$(echo "$refreshed" | jq -r .accessToken)
refresh2=$(echo "$refreshed" | jq -r .refreshToken)
[ "$refresh2" != "$refresh1" ] || fail "refresh token did not rotate"
[ "$access2" != "$access1" ] || fail "access token did not change"
ok "new tokens issued, refresh rotated"

section "new access token works"
curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/me" -H "authorization: Bearer $access2" | grep -q 200 \
  || fail "new access token did not work"
ok "new access token accepted"

section "reusing old refresh → 401 and family revoked"
reuse_status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$refresh1\"}")
[ "$reuse_status" = "401" ] || fail "expected 401 on reuse, got $reuse_status"
ok "reuse detected → 401"

section "second refresh now also fails (family revoked)"
postfamily_status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$refresh2\"}")
[ "$postfamily_status" = "401" ] || fail "expected 401 after family revoke, got $postfamily_status"
ok "family revoke confirmed"

section "login again → fresh family"
login=$(curl -sS -X POST "$BASE/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
refresh3=$(echo "$login" | jq -r .refreshToken)
[ -n "$refresh3" ] && [ "$refresh3" != "null" ] || fail "login did not return refreshToken"
ok "fresh login works after family revoke"

section "logout revokes current refresh"
logout_status=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/logout" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$refresh3\"}")
[ "$logout_status" = "204" ] || fail "expected 204 on logout, got $logout_status"
afterlogout=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refreshToken\":\"$refresh3\"}")
[ "$afterlogout" = "401" ] || fail "expected 401 after logout, got $afterlogout"
ok "logout invalidates refresh token"

printf '\n\033[1;32mAll checks passed.\033[0m  Test user: %s\n' "$EMAIL"
