#!/usr/bin/env bash
# Generates a production .env for Analytikul from .env.example with fresh secrets.
# Run on the production host from the repo root. Provider key is read from
# stdin or $AGENT_KEY so it never appears in argv/history.
set -euo pipefail

[ -f .env ] && { echo ".env already exists — refusing to overwrite"; exit 1; }
cp .env.example .env

set_var() {
  local name="$1" value="$2"
  if grep -q "^#*${name}=" .env; then
    sed -i "s|^#*${name}=.*|${name}=${value}|" .env
  else
    printf '%s=%s\n' "$name" "$value" >> .env
  fi
}

rand_hex() { openssl rand -hex "$1"; }

AGENT_KEY="${AGENT_KEY:-}"
if [ -z "$AGENT_KEY" ]; then
  read -r AGENT_KEY
fi

set_var APP_TITLE Analytikul
set_var HOST 0.0.0.0
set_var DOMAIN_CLIENT https://analytikul.ai
set_var DOMAIN_SERVER https://analytikul.ai
set_var NO_INDEX false
set_var JWT_SECRET "$(rand_hex 32)"
set_var JWT_REFRESH_SECRET "$(rand_hex 32)"
set_var CREDS_KEY "$(rand_hex 32)"
set_var CREDS_IV "$(rand_hex 16)"
set_var MEILI_MASTER_KEY "$(rand_hex 16)"
set_var POSTGRES_PASSWORD "$(rand_hex 16)"
set_var ANALYTIKUL_VAULT_KEY "$(rand_hex 32)"
set_var ANTHROPIC_API_KEY "$AGENT_KEY"
set_var AGENT_DEFAULT_API_KEY "$AGENT_KEY"
set_var AGENT_DEFAULT_PROVIDER anthropic
set_var AGENT_DEFAULT_MODEL claude-sonnet-4-6
set_var AGENT_DEFAULT_BASE_URL https://api.anthropic.com
set_var ALLOW_REGISTRATION true

chmod 600 .env
echo "production .env written ($(grep -c '=' .env) vars), secrets regenerated"
