#!/bin/bash
# Event Day Dry-Run Check
# Usage: ./dryrun.sh
# Tests every critical flow before the live event.

BASE="http://localhost:4000"
PASS=0
FAIL=0
WARNS=()

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}✔${NC} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✘${NC} $1"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; WARNS+=("$1"); }
info() { echo -e "  ${CYAN}→${NC} $1"; }
header() { echo -e "\n${BOLD}$1${NC}"; }

echo -e "${BOLD}================================================${NC}"
echo -e "${BOLD}  Event Day Dry-Run  $(date '+%Y-%m-%d %H:%M UTC')${NC}"
echo -e "${BOLD}================================================${NC}"

# ── 1. Containers ────────────────────────────────────────────
header "1. Containers"
for name in backend frontend db proxy; do
  STATUS=$(docker ps --filter "name=event-checkin-${name}" --format "{{.Status}}" 2>/dev/null | head -1)
  if echo "$STATUS" | grep -q "^Up"; then
    ok "event-checkin-${name} — $STATUS"
  else
    fail "event-checkin-${name} — NOT running (status: ${STATUS:-missing})"
  fi
done

# ── 2. API health ────────────────────────────────────────────
header "2. API Health"
HEALTH=$(curl -sf "$BASE/api/health" 2>/dev/null)
if echo "$HEALTH" | grep -q '"ok"'; then
  ok "API health endpoint"
else
  fail "API health endpoint — got: $HEALTH"
fi

LATENCY=$(curl -sf -o /dev/null -w "%{time_total}" "$BASE/api/health" 2>/dev/null)
if (( $(echo "$LATENCY < 0.5" | bc -l) )); then
  ok "API latency ${LATENCY}s"
else
  warn "API latency ${LATENCY}s — higher than expected"
fi

# ── 3. Public HTTPS via Cloudflare ───────────────────────────
header "3. Public HTTPS (Cloudflare)"
DOMAIN=$(grep "FRONTEND_URL" /home/ubuntu/e-events/event-checkin/backend/.env | cut -d= -f2 | xargs)
if [ -n "$DOMAIN" ]; then
  HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" "${DOMAIN}/api/health" 2>/dev/null)
  if [ "$HTTP_CODE" = "200" ]; then
    ok "Public URL reachable: $DOMAIN"
  else
    fail "Public URL returned HTTP $HTTP_CODE: $DOMAIN"
  fi

  CF_HEADER=$(curl -sI "${DOMAIN}/api/health" 2>/dev/null | grep -i "cf-ray")
  if [ -n "$CF_HEADER" ]; then
    ok "Cloudflare proxy confirmed (CF-Ray present)"
  else
    warn "CF-Ray header missing — Cloudflare may not be proxying"
  fi

  SSL_EXPIRY=$(echo | openssl s_client -connect "${DOMAIN#https://}:443" -servername "${DOMAIN#https://}" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$SSL_EXPIRY" ]; then
    DAYS_LEFT=$(( ( $(date -d "$SSL_EXPIRY" +%s) - $(date +%s) ) / 86400 ))
    if [ "$DAYS_LEFT" -gt 7 ]; then
      ok "SSL cert valid — expires in ${DAYS_LEFT} days ($SSL_EXPIRY)"
    else
      fail "SSL cert expires in ${DAYS_LEFT} days — RENEW NOW"
    fi
  fi
else
  warn "FRONTEND_URL not set — skipping public URL checks"
fi

# ── 4. Database ──────────────────────────────────────────────
header "4. Database"
DB_ALIVE=$(docker exec event-checkin-db-1 psql -U checkin -d checkin -t -c "SELECT 1;" 2>/dev/null | xargs)
if [ "$DB_ALIVE" = "1" ]; then
  ok "PostgreSQL responding"
else
  fail "PostgreSQL not responding"
fi

# Guest count
GUEST_COUNT=$(docker exec event-checkin-db-1 psql -U checkin -d checkin -t -c \
  "SELECT COUNT(*) FROM guests;" 2>/dev/null | xargs)
QR_COUNT=$(docker exec event-checkin-db-1 psql -U checkin -d checkin -t -c \
  "SELECT COUNT(*) FROM guests WHERE qr_token IS NOT NULL;" 2>/dev/null | xargs)
NO_QR=$(( GUEST_COUNT - QR_COUNT ))

ok "Total guests: $GUEST_COUNT"

if [ "$NO_QR" -eq 0 ]; then
  ok "All guests have QR tokens"
else
  warn "$NO_QR guests missing QR tokens — run Generate QR in admin panel"
fi

# Active event
EVENT_COUNT=$(docker exec event-checkin-db-1 psql -U checkin -d checkin -t -c \
  "SELECT COUNT(*) FROM events WHERE status='active';" 2>/dev/null | xargs)
if [ "$EVENT_COUNT" -gt 0 ]; then
  ok "$EVENT_COUNT active event(s) found"
else
  fail "No active events — set event status to 'active' in admin panel"
fi

# Latest backup
LATEST_BACKUP=$(ls -t /home/ubuntu/e-events/event-checkin/backups/*.sql.gz 2>/dev/null | head -1)
if [ -n "$LATEST_BACKUP" ]; then
  BACKUP_AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$LATEST_BACKUP") ) / 3600 ))
  if [ "$BACKUP_AGE_HOURS" -lt 25 ]; then
    ok "Latest backup: $(basename $LATEST_BACKUP) (${BACKUP_AGE_HOURS}h ago)"
  else
    warn "Latest backup is ${BACKUP_AGE_HOURS}h old — expected daily"
  fi
else
  warn "No database backups found"
fi

# ── 5. Scanner flow ──────────────────────────────────────────
header "5. Scanner Flow (end-to-end)"
QR_TOKEN=$(docker exec event-checkin-db-1 psql -U checkin -d checkin -t -c \
  "SELECT qr_token FROM guests WHERE qr_token IS NOT NULL AND admitted=false LIMIT 1;" 2>/dev/null | xargs)

if [ -z "$QR_TOKEN" ]; then
  warn "No unadmitted guest with QR found — skipping scanner test"
else
  info "Using test token: $QR_TOKEN"

  # Ticket lookup
  TICKET=$(curl -sf "$BASE/api/scan/$QR_TOKEN/ticket" 2>/dev/null)
  if echo "$TICKET" | grep -q '"status":"valid"'; then
    GNAME=$(echo "$TICKET" | python3 -c "import sys,json; g=json.load(sys.stdin).get('guest',{}); print(g.get('first_name','?'), g.get('last_name','?'))" 2>/dev/null)
    ok "Ticket lookup — guest: $GNAME"
  else
    fail "Ticket lookup failed — response: $(echo $TICKET | head -c 100)"
  fi

  # QR card image
  CARD_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE/api/scan/$QR_TOKEN/card.jpg" 2>/dev/null)
  if [ "$CARD_STATUS" = "200" ]; then
    ok "QR card image (card.jpg) accessible"
  else
    fail "QR card image returned HTTP $CARD_STATUS"
  fi

  # QR PNG
  QR_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" "$BASE/api/scan/$QR_TOKEN/qr.png" 2>/dev/null)
  if [ "$QR_STATUS" = "200" ]; then
    ok "QR PNG accessible"
  else
    fail "QR PNG returned HTTP $QR_STATUS"
  fi

  info "Scanner URL to test on mobile: ${DOMAIN:-http://YOUR_DOMAIN}/scan"
fi

# ── 6. Messaging ─────────────────────────────────────────────
header "6. Messaging (ClickSend)"
CLICKSEND_USER=$(grep "CLICKSEND_USERNAME" /home/ubuntu/e-events/event-checkin/backend/.env | cut -d= -f2 | xargs)
CLICKSEND_KEY=$(grep "CLICKSEND_API_KEY" /home/ubuntu/e-events/event-checkin/backend/.env | cut -d= -f2 | xargs)

if [ -n "$CLICKSEND_USER" ] && [ -n "$CLICKSEND_KEY" ]; then
  CS_RESP=$(curl -sf -u "$CLICKSEND_USER:$CLICKSEND_KEY" "https://rest.clicksend.com/v3/account" 2>/dev/null)
  CS_STATUS=$(echo "$CS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('response_msg','error'))" 2>/dev/null)
  CS_BALANCE=$(echo "$CS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('balance','?'))" 2>/dev/null)

  if echo "$CS_STATUS" | grep -qi "account\|here"; then
    ok "ClickSend credentials valid"
    BALANCE_NUM=$(echo "$CS_BALANCE" | tr -d ' ')
    if (( $(echo "$BALANCE_NUM > 10" | bc -l 2>/dev/null) )); then
      ok "ClickSend balance: \$$CS_BALANCE"
    else
      warn "ClickSend balance LOW: \$$CS_BALANCE — top up before event day"
    fi
  else
    fail "ClickSend credentials failed — $CS_STATUS"
  fi
else
  warn "ClickSend not configured"
fi

# ── 7. Server resources ──────────────────────────────────────
header "7. Server Resources"
DISK_PCT=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_PCT" -lt 80 ]; then
  DISK_FREE=$(df -h / | tail -1 | awk '{print $4}')
  ok "Disk: ${DISK_PCT}% used, ${DISK_FREE} free"
else
  warn "Disk usage high: ${DISK_PCT}%"
fi

MEM_FREE=$(free -m | grep Mem | awk '{print $7}')
if [ "$MEM_FREE" -gt 200 ]; then
  ok "Memory: ${MEM_FREE}MB available"
else
  warn "Memory available low: ${MEM_FREE}MB"
fi

LOAD=$(cat /proc/loadavg | awk '{print $1}')
ok "CPU load average: $LOAD"

SWAP_TOTAL=$(free -m | grep Swap | awk '{print $3}')
APP_SWAP=0
for pid in $(ls /proc | grep -E '^[0-9]+$' 2>/dev/null); do
  swap=$(grep VmSwap /proc/$pid/status 2>/dev/null | awk '{print $2}')
  [ -z "$swap" ] || [ "$swap" -eq 0 ] 2>/dev/null && continue
  cmd=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\0' ' ')
  echo "$cmd" | grep -q "vscode\|claude\|node.*server" || APP_SWAP=$((APP_SWAP + swap))
done
APP_SWAP_MB=$(( APP_SWAP / 1024 ))
VSCODE_SWAP_MB=$(( SWAP_TOTAL - APP_SWAP_MB ))
if [ "$APP_SWAP_MB" -lt 600 ]; then
  ok "App swap: ${APP_SWAP_MB}MB (VSCode/IDE accounts for remaining ${VSCODE_SWAP_MB}MB — clears when IDE disconnects)"
else
  warn "App swap high: ${APP_SWAP_MB}MB — restart containers if this persists on event day"
fi

# ── 8. Firewall ──────────────────────────────────────────────
header "8. Firewall"
UFW_STATUS=$(sudo ufw status 2>/dev/null | head -1)
if echo "$UFW_STATUS" | grep -q "active"; then
  ok "UFW firewall active"
  sudo ufw status | grep -E "DENY" | while read line; do
    info "Blocked: $line"
  done
else
  warn "UFW firewall is NOT active — server ports exposed"
fi

# ── Summary ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}================================================${NC}"
echo -e "${BOLD}  Summary${NC}"
echo -e "${BOLD}================================================${NC}"
echo -e "  ${GREEN}Passed: $PASS${NC}   ${RED}Failed: $FAIL${NC}   ${YELLOW}Warnings: ${#WARNS[@]}${NC}"

if [ ${#WARNS[@]} -gt 0 ]; then
  echo -e "\n${YELLOW}Warnings to address:${NC}"
  for w in "${WARNS[@]}"; do
    echo -e "  ${YELLOW}⚠${NC} $w"
  done
fi

if [ "$FAIL" -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}  ✔ System ready for event day${NC}"
else
  echo -e "\n${RED}${BOLD}  ✘ $FAIL critical issue(s) must be fixed before event day${NC}"
fi
echo ""
