#!/usr/bin/env bash
# Copies the waar Connect database from one server to another, from the development PC over SSH.
# The target's own database is replaced in one transaction: either all of it arrives or nothing
# changes. The source is only read; it keeps running unless it was stopped before.
#
#   bash deploy/vm/move/copy-data.sh <from host> <to host>
#
# FROM_ALIAS / TO_ALIAS: the name a server's SSH host key is filed under, for a server whose address
# changes during a move (ssh -o HostKeyAlias). KEY and SSH_USER as in switch.sh.
set -euo pipefail

FROM=${1:?usage: copy-data.sh <from host> <to host>}
TO=${2:?usage: copy-data.sh <from host> <to host>}
KEY=${KEY:-$HOME/.ssh/waar-connect}
SSH_USER=${SSH_USER:-meysam}
say() { echo "$(date -u +%T) $*"; }

on() { # on <host> <alias or ''> <command>
  local host=$1 alias=$2
  shift 2
  ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=10 ${alias:+-o HostKeyAlias="$alias"} "$SSH_USER@$host" "$@"
}
from() { on "$FROM" "${FROM_ALIAS:-}" "$@"; }
to() { on "$TO" "${TO_ALIAS:-}" "$@"; }
PSQL='cd /opt/waar-connect-db && sudo docker compose exec -T db psql -U waarconnect -d waarconnect -At -F" "'
# rows per table, one line each
counts() {
  "$1" "$PSQL" <<'SQL'
select table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I', table_name), false, true, '')))[1]::text
from information_schema.tables where table_schema = 'public' order by 1;
SQL
}

say "rows on $FROM"
BEFORE=$(counts from)
[ -n "$BEFORE" ] || { say "could not read the database on $FROM"; exit 1; }
echo "$BEFORE" | awk '{n += $2} END {print "   " NR " tables, " n " rows"}'

say "stopping the API and the gateway on $TO"
to 'sudo systemctl stop waar-connect-gateway waar-connect-api'

say "copying"
from 'cd /opt/waar-connect-db && sudo docker compose exec -T db pg_dump -U waarconnect -d waarconnect -Fc' |
  to 'cd /opt/waar-connect-db && sudo docker compose exec -T db pg_restore -U waarconnect -d waarconnect --clean --if-exists --no-owner --single-transaction'

say "starting the API and the gateway on $TO"
to 'sudo systemctl start waar-connect-api && sleep 3 && sudo systemctl start waar-connect-gateway && sleep 2 && curl -s -m 5 127.0.0.1:8788/api/v1/health | grep -q "\"ok\":true" && echo "   API healthy"'

AFTER=$(counts to)
if [ "$BEFORE" = "$AFTER" ]; then
  say "COPIED: every table has the same number of rows on both servers"
else
  say "DIFFERENT after the copy (the source may have changed meanwhile):"
  diff <(echo "$BEFORE") <(echo "$AFTER") | sed 's/^/   /' || true
  exit 1
fi
to 'curl -s -m 5 -H "x-wc-role: admin" http://127.0.0.1:8788/api/v1/pcrs' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log("   studios on the target:",JSON.parse(s).pcrs.map(p=>p.name+" ("+(p.settings?.slots??"?")+" slots)").join(", "))})'
