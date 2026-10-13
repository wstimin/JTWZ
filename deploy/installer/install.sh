#!/usr/bin/env bash
set -Eeuo pipefail

PANEL="${1:-standalone}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="${JTWZ_SOURCE_DIR:-$PACKAGE_DIR/app}"
APP_DIR="${JTWZ_APP_DIR:-/opt/jtwz}"
SERVICE_NAME="jtwz"
LEGACY_ENV_FILE="$APP_DIR/.env"
if [[ "$PANEL" == '1panel' ]]; then
  ENV_FILE="$APP_DIR/app/.env"
else
  ENV_FILE="$APP_DIR/data/config.env"
  [[ -f "$ENV_FILE" ]] || [[ ! -f "$LEGACY_ENV_FILE" ]] || ENV_FILE="$LEGACY_ENV_FILE"
fi
TARGET_DIR="$APP_DIR"
API_PORT="${JTWZ_API_PORT:-8787}"
API_BIND_HOST='127.0.0.1'
USE_REVERSE_PROXY='false'
PUBLIC_BASE_URL=''
ADMIN_BASE_URL=''
ADMIN_BASE_PATH='/admin'
EXISTING_INSTALL='false'
UPDATE_PUBLIC_KEY_B64_VALUE=''
UPDATE_APPLY_COMMAND_VALUE='/usr/local/bin/jtwz-update-dispatch'
UPDATE_APPLY_ARGS_JSON_VALUE='[]'
DOMAIN_APPLY_COMMAND_VALUE=''
DOMAIN_APPLY_ARGS_JSON_VALUE='[]'
CERTIFICATE_PROVIDER_VALUE='manual'
[[ -d "$SOURCE_DIR" ]] || SOURCE_DIR="$(cd -- "$PACKAGE_DIR/.." && pwd)"
if [[ "$PANEL" != '1panel' ]]; then
  UPDATE_APPLY_COMMAND_VALUE='/usr/local/bin/jtwz-update-dispatch'
  UPDATE_APPLY_ARGS_JSON_VALUE='[]'
  DOMAIN_APPLY_COMMAND_VALUE='/usr/local/bin/jtwz-domain-dispatch'
  DOMAIN_APPLY_ARGS_JSON_VALUE='[]'
else
  UPDATE_APPLY_COMMAND_VALUE=''
fi
say() { printf '\n[JTWZ] %s\n' "$*"; }
die() { printf '\n[JTWZ][错误] %s\n' "$*" >&2; exit 1; }
ask() { local prompt="$1" default="${2:-}" value; if [[ -n "$default" ]]; then read -r -p "$prompt [$default]: " value; printf '%s' "${value:-$default}"; else read -r -p "$prompt: " value; printf '%s' "$value"; fi; }
ask_secret() { local prompt="$1" value; read -r -s -p "$prompt: " value; printf '\n' >&2; printf '%s' "$value"; }

is_public_ipv4() {
  local ip="$1" a b c d
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  IFS=. read -r a b c d <<< "$ip"
  (( a <= 255 && b <= 255 && c <= 255 && d <= 255 )) || return 1
  (( a <= 223 && a != 0 && a != 10 && a != 127 )) || return 1
  (( a != 100 || b < 64 || b > 127 )) || return 1
  (( a != 169 || b != 254 )) || return 1
  (( a != 172 || b < 16 || b > 31 )) || return 1
  (( a != 192 || b != 168 )) || return 1
  (( a != 198 || b < 18 || b > 19 )) || return 1
  (( a != 224 )) || return 1
  return 0
}

is_public_ipv6() {
  local ip="${1,,}"
  [[ "$ip" == *:* ]] || return 1
  [[ "$ip" != ::1 && "$ip" != fc* && "$ip" != fd* && "$ip" != fe80:* ]] || return 1
  return 0
}

is_public_address() {
  local value="${1,,}"
  if [[ "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    is_public_ipv4 "$value"
    return
  fi
  if [[ "$value" == *:* ]]; then
    is_public_ipv6 "$value"
    return
  fi
  [[ "$value" != *://* && "$value" != */* && "$value" != *' '* ]] || return 1
  [[ "$value" != 'localhost' && "$value" != *.local && "$value" != *.lan && "$value" != *.internal ]] || return 1
  [[ "$value" =~ ^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?(\.[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?)+$ ]]
}

detect_public_ip() {
  local endpoint candidate
  for endpoint in https://api.ipify.org https://ifconfig.me/ip https://icanhazip.com; do
    candidate="$(curl -4 -fsSL --connect-timeout 3 --max-time 8 "$endpoint" 2>/dev/null | tr -d '\r\n ' || true)"
    if is_public_ipv4 "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  for endpoint in https://api64.ipify.org https://ifconfig.co/ip; do
    candidate="$(curl -6 -fsSL --connect-timeout 3 --max-time 8 "$endpoint" 2>/dev/null | tr -d '\r\n ' || true)"
    if is_public_ipv6 "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

validate_public_address() {
  local value="${1:-}"
  is_public_address "$value" || die "必须使用公网 IP 或公网域名，当前地址无效：${value:-<空>}"
}

normalize_admin_base_path() {
  local value="${1:-/admin}"
  value="/${value#/}"; value="${value%/}"; value="${value,,}"
  [[ "$value" =~ ^/[a-z0-9][a-z0-9_-]{3,63}$ ]] || die '管理入口后缀需为 4-64 位字母、数字、短横线或下划线。'
  case "$value" in /api|/assets|/admin-assets|/downloads|/preview|/login) die '该管理入口后缀属于系统保留路径。' ;; esac
  printf '%s' "$value"
}

origin_host() {
  [[ "$1" == *:* ]] && printf '[%s]' "$1" || printf '%s' "$1"
}

is_ip_address() {
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || "$1" == *:* ]]
}

install_reverse_proxy_tools() {
  [[ "$PANEL" == 'standalone' ]] || return 0
  if ! command -v nginx >/dev/null || ! command -v certbot >/dev/null; then
    say '正在安装自定义域名所需的 Nginx 与 Certbot。'
    if command -v apt-get >/dev/null; then
      apt-get update -y
      apt-get install -y nginx certbot python3-certbot-nginx
    elif command -v dnf >/dev/null; then
      dnf install -y nginx certbot python3-certbot-nginx
    else
      die '无法自动安装 Nginx 与 Certbot，请先手动安装后重试。'
    fi
  fi
  systemctl enable --now nginx
  CERTIFICATE_PROVIDER_VALUE='certbot'
}

select_access_mode() {
  local public_host admin_host
  public_host="$(origin_host "$PUBLIC_DOMAIN")"
  admin_host="$(origin_host "$ADMIN_DOMAIN")"

  if [[ "$PANEL" != 'standalone' ]]; then
    USE_REVERSE_PROXY='true'
  elif ! is_ip_address "$PUBLIC_DOMAIN" && command -v nginx >/dev/null; then
    USE_REVERSE_PROXY='true'
  else
    USE_REVERSE_PROXY='false'
  fi

  if [[ "$USE_REVERSE_PROXY" == 'true' ]]; then
    API_BIND_HOST='127.0.0.1'
    [[ "$PANEL" == '1panel' ]] && API_BIND_HOST='0.0.0.0'
    PUBLIC_BASE_URL="http://$public_host"
    ADMIN_BASE_URL="http://$admin_host"
    [[ "$PANEL" == 'standalone' ]] && CERTIFICATE_PROVIDER_VALUE='certbot'
  else
    API_BIND_HOST='0.0.0.0'
    PUBLIC_BASE_URL="http://$public_host:$API_PORT"
    ADMIN_BASE_URL="http://$admin_host:$API_PORT"
  fi
}

[[ "$(id -u)" == 0 ]] || die '请使用 root 执行安装。'
command -v curl >/dev/null || die '缺少 curl，请先安装后重试。'
command -v openssl >/dev/null || die '缺少 openssl，请先安装后重试。'
if [[ -f "$SCRIPT_DIR/update-public-key.pem" ]]; then UPDATE_PUBLIC_KEY_B64_VALUE="$(openssl base64 -A -in "$SCRIPT_DIR/update-public-key.pem")"; fi

install_node() {
  if ! command -v python3 >/dev/null; then
    if command -v apt-get >/dev/null; then
      apt-get update -y
      apt-get install -y python3
    elif command -v dnf >/dev/null; then
      dnf install -y python3
    else
      die '缺少 python3，且无法识别 apt 或 dnf。'
    fi
  fi
  command -v node >/dev/null && command -v npm >/dev/null && return
  if command -v apt-get >/dev/null; then
    apt-get update -y
    apt-get install -y ca-certificates curl gnupg python3
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  elif command -v dnf >/dev/null; then
    dnf install -y ca-certificates curl python3
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  else
    die '未检测到 Node.js，也无法识别 apt 或 dnf。'
  fi
}

prompt_settings() {
  local existing_domain='' existing_admin='admin' detected_ip=''
  [[ -f "$ENV_FILE" ]] && existing_domain="$(grep -E '^(PUBLIC_ADDRESS|PUBLIC_DOMAIN)=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)" && existing_admin="$(grep -E '^ADMIN_USERNAME=' "$ENV_FILE" | cut -d= -f2- || true)"
  detected_ip="$(detect_public_ip || true)"
  if [[ -n "$detected_ip" ]]; then
    say "已自动识别公网 IP：$detected_ip"
  else
    say '无法从外部服务自动识别公网 IP，将改为手动输入公网 IP 或域名。'
  fi
  PUBLIC_DOMAIN="$(ask '公开访问地址（自动识别结果，可改为公网域名）' "${existing_domain:-$detected_ip}")"
  ADMIN_DOMAIN="$(ask '管理访问地址（默认与公开地址相同）' "${ADMIN_DOMAIN:-$PUBLIC_DOMAIN}")"
  ADMIN_BASE_PATH="$(normalize_admin_base_path "$(ask '管理后台入口后缀' '/admin')")"
  ADMIN_USERNAME="$(ask '管理员账号' "$existing_admin")"
  ADMIN_PASSWORD="$(ask_secret '管理员密码（至少 6 位）')"
  [[ "${#ADMIN_PASSWORD}" -ge 6 ]] || die '管理员密码至少需要 6 位。'
  APP_SECRET="$(openssl rand -hex 32)"
  SUPPORT_EMAIL="$(ask '支持邮箱（可留空）' '')"
}

load_existing_env() {
  PUBLIC_DOMAIN="$(grep -E '^(PUBLIC_ADDRESS|PUBLIC_DOMAIN)=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
  [[ -n "$PUBLIC_DOMAIN" ]] || PUBLIC_DOMAIN="$(grep -E '^PUBLIC_APP_ORIGIN=' "$ENV_FILE" | cut -d= -f2- | sed -E 's#^https?://##; s#/$##' || true)"
  ADMIN_DOMAIN="$(grep -E '^(ADMIN_ADDRESS|ADMIN_DOMAIN)=' "$ENV_FILE" | head -n 1 | cut -d= -f2- || true)"
  ADMIN_BASE_PATH="$(grep -E '^ADMIN_BASE_PATH=' "$ENV_FILE" | cut -d= -f2- || true)"; ADMIN_BASE_PATH="$(normalize_admin_base_path "${ADMIN_BASE_PATH:-/admin}")"
  ADMIN_USERNAME="$(grep -E '^ADMIN_USERNAME=' "$ENV_FILE" | cut -d= -f2- || true)"
  ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2- || true)"
  APP_SECRET="$(grep -E '^APP_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)"
  SUPPORT_EMAIL="$(grep -E '^SUPPORT_EMAIL=' "$ENV_FILE" | cut -d= -f2- || true)"
}

write_env() {
  install -d -m 750 "$APP_DIR/data" "$APP_DIR/data/backups" "$APP_DIR/data/storage" "$APP_DIR/data/site-releases" "$APP_DIR/data/temp" "$APP_DIR/data/brand-assets" "$APP_DIR/data/updates"
  if [[ "$EXISTING_INSTALL" == 'true' ]]; then
    upsert_env COOKIE_SECURE auto
    upsert_env API_HOST "$API_BIND_HOST"
    upsert_env API_PORT "$API_PORT"
    upsert_env APP_HOST "$API_BIND_HOST"
    upsert_env PUBLIC_ADDRESS "$PUBLIC_DOMAIN"
    upsert_env ADMIN_ADDRESS "$ADMIN_DOMAIN"
    upsert_env PUBLIC_DOMAIN "$PUBLIC_DOMAIN"
    upsert_env ADMIN_DOMAIN "$ADMIN_DOMAIN"
    upsert_env ADMIN_BASE_PATH "$ADMIN_BASE_PATH"
    upsert_env PUBLIC_URL "$PUBLIC_BASE_URL"
    upsert_env ADMIN_LOGIN_URL "$ADMIN_BASE_URL$ADMIN_BASE_PATH/login"
    upsert_env APP_ORIGIN "$PUBLIC_BASE_URL"
    upsert_env PUBLIC_APP_ORIGIN "$PUBLIC_BASE_URL"
    upsert_env ADMIN_APP_ORIGIN "$ADMIN_BASE_URL"
    upsert_env UPDATE_MANIFEST_URL 'https://github.com/wstimin/JTWZ/releases/latest/download/update-manifest.json'
    if [[ -n "$UPDATE_PUBLIC_KEY_B64_VALUE" ]]; then
      remove_multiline_env_key UPDATE_PUBLIC_KEY
      upsert_env UPDATE_PUBLIC_KEY_B64 "$UPDATE_PUBLIC_KEY_B64_VALUE"
    fi
    upsert_env UPDATE_APPLY_COMMAND "$UPDATE_APPLY_COMMAND_VALUE"
    upsert_env UPDATE_APPLY_ARGS_JSON "$UPDATE_APPLY_ARGS_JSON_VALUE"
    upsert_env DOMAIN_APPLY_COMMAND "$DOMAIN_APPLY_COMMAND_VALUE"
    upsert_env DOMAIN_APPLY_ARGS_JSON "$DOMAIN_APPLY_ARGS_JSON_VALUE"
    upsert_env CERTIFICATE_PROVIDER "$CERTIFICATE_PROVIDER_VALUE"
    chmod 600 "$ENV_FILE"
    return
  fi
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
COOKIE_SECURE=auto
API_HOST=$API_BIND_HOST
API_PORT=$API_PORT
APP_HOST=$API_BIND_HOST
PUBLIC_ADDRESS=$PUBLIC_DOMAIN
ADMIN_ADDRESS=$ADMIN_DOMAIN
PUBLIC_DOMAIN=$PUBLIC_DOMAIN
ADMIN_DOMAIN=$ADMIN_DOMAIN
ADMIN_BASE_PATH=$ADMIN_BASE_PATH
PUBLIC_URL=$PUBLIC_BASE_URL
ADMIN_LOGIN_URL=$ADMIN_BASE_URL$ADMIN_BASE_PATH/login
APP_ORIGIN=$PUBLIC_BASE_URL
PUBLIC_APP_ORIGIN=$PUBLIC_BASE_URL
ADMIN_APP_ORIGIN=$ADMIN_BASE_URL
ADMIN_USERNAME=$ADMIN_USERNAME
ADMIN_PASSWORD=$ADMIN_PASSWORD
APP_SECRET=$APP_SECRET
STORAGE_PROVIDER=local
ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true
BACKUP_INTERVAL_HOURS=24
BACKUP_RETENTION_DAYS=30
SUPPORT_EMAIL=$SUPPORT_EMAIL
UPDATE_MANIFEST_URL=https://github.com/wstimin/JTWZ/releases/latest/download/update-manifest.json
UPDATE_PUBLIC_KEY_B64=$UPDATE_PUBLIC_KEY_B64_VALUE
UPDATE_APPLY_COMMAND=$UPDATE_APPLY_COMMAND_VALUE
UPDATE_APPLY_ARGS_JSON=$UPDATE_APPLY_ARGS_JSON_VALUE
DOMAIN_APPLY_COMMAND=$DOMAIN_APPLY_COMMAND_VALUE
DOMAIN_APPLY_ARGS_JSON=$DOMAIN_APPLY_ARGS_JSON_VALUE
CERTIFICATE_PROVIDER=$CERTIFICATE_PROVIDER_VALUE
EOF
  chmod 600 "$ENV_FILE"
  if [[ "$PANEL" == '1panel' ]]; then ln -sfn "$ENV_FILE" "$APP_DIR/.env"; fi
}

upsert_env() {
  local key="$1" value="$2" temp_file
  temp_file="$(mktemp)"
  awk -v key="$key" -v value="$value" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 { print key "=" value; found = 1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "$ENV_FILE" > "$temp_file"
  install -m 600 "$temp_file" "$ENV_FILE"
  rm -f "$temp_file"
}

remove_multiline_env_key() {
  local key="$1" temp_file
  [[ -f "$ENV_FILE" ]] || return 0
  temp_file="$(mktemp)"
  awk -v target="$key" '
    BEGIN { skipping = 0 }
    $0 ~ "^" target "=" { skipping = 1; next }
    skipping && /^[A-Za-z_][A-Za-z0-9_]*=/ { skipping = 0 }
    skipping { next }
    { print }
  ' "$ENV_FILE" > "$temp_file"
  install -m 600 "$temp_file" "$ENV_FILE"
  rm -f "$temp_file"
}

install_application() {
  [[ -d "$SOURCE_DIR" ]] || die "未找到应用文件目录：$SOURCE_DIR"
  [[ "$PANEL" == '1panel' ]] || install_node
  [[ "$PANEL" == '1panel' ]] && TARGET_DIR="$APP_DIR/app"
  if [[ "$PANEL" == '1panel' ]]; then
    ENV_FILE="$TARGET_DIR/.env"
  else
    install -d -m 750 "$APP_DIR/data"
    if [[ "$EXISTING_INSTALL" == 'true' && -f "$APP_DIR/.env" && ! -f "$APP_DIR/data/config.env" ]]; then
      cp "$APP_DIR/.env" "$APP_DIR/data/config.env"
    fi
    ENV_FILE="$APP_DIR/data/config.env"
  fi
  install -d -m 755 "$TARGET_DIR"
  cp -a "$SOURCE_DIR"/. "$TARGET_DIR"/
  if [[ "$PANEL" != '1panel' ]]; then
    if [[ -f "$SOURCE_DIR/dist-server/index.js" ]]; then
      if [[ -f "$TARGET_DIR/package-lock.json" ]]; then npm --prefix "$TARGET_DIR" ci --omit=dev; else npm --prefix "$TARGET_DIR" install --omit=dev; fi
    else
      if [[ -f "$TARGET_DIR/package-lock.json" ]]; then npm --prefix "$TARGET_DIR" ci; else npm --prefix "$TARGET_DIR" install; fi
      npm --prefix "$TARGET_DIR" run build
      npm --prefix "$TARGET_DIR" prune --omit=dev
    fi
  else
    [[ -f "$TARGET_DIR/dist-server/index.js" ]] || die '1Panel 包缺少已构建的 dist-server，请重新下载完整安装包。'
  fi
  write_env
}

write_systemd() {
  id -u jtwz >/dev/null 2>&1 || useradd --system --home-dir /var/lib/jtwz --create-home --shell /usr/sbin/nologin jtwz
  install -d -o jtwz -g jtwz -m 750 "$APP_DIR/data"
  chown -R jtwz:jtwz "$APP_DIR/data"
  chown root:jtwz "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=JTWZ platform API and public service
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
Environment=JTWZ_ENV_FILE=$ENV_FILE
ExecStart=$(command -v node) $APP_DIR/dist-server/index.js
Restart=on-failure
RestartSec=5
User=jtwz
Group=jtwz
UMask=0027
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
ReadWritePaths=$APP_DIR -/usr/local/bin -/etc/systemd/system -/etc/sudoers.d -/etc/nginx -/etc/letsencrypt -/var/lib/letsencrypt -/var/log/letsencrypt

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl restart "$SERVICE_NAME"
}

write_update_dispatch_units() {
  [[ "$PANEL" != '1panel' ]] || return 0
  cat > /etc/systemd/system/jtwz-update-apply.service <<EOF
[Unit]
Description=JTWZ signed update apply service
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jtwz-update-dispatch --apply
User=root
Group=root
UMask=0027
EOF
  cat > /etc/systemd/system/jtwz-update.path <<EOF
[Unit]
Description=Watch for JTWZ signed update requests

[Path]
PathExists=$APP_DIR/data/updates/apply.request
Unit=jtwz-update-apply.service

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now jtwz-update.path
}

write_domain_dispatch_units() {
  [[ "$PANEL" != '1panel' ]] || return 0
  cat > /etc/systemd/system/jtwz-domain-apply.service <<EOF
[Unit]
Description=JTWZ privileged domain and certificate apply service
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/jtwz-domain-dispatch --apply
User=root
Group=root
UMask=0027
EOF
  cat > /etc/systemd/system/jtwz-domain.path <<EOF
[Unit]
Description=Watch for JTWZ domain and certificate requests

[Path]
PathExists=$APP_DIR/data/domain-jobs/apply.request
Unit=jtwz-domain-apply.service

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now jtwz-domain.path
}

write_nginx() {
  [[ "$USE_REVERSE_PROXY" == 'true' && "$PANEL" != '1panel' ]] || return 0
  command -v nginx >/dev/null || die '当前配置需要 Nginx 反向代理，但服务器未安装 Nginx。'
  mkdir -p /etc/nginx/conf.d
  cat > /etc/nginx/conf.d/jtwz.conf <<EOF
server {
  listen 80;
  listen [::]:80;
  server_name _;
  client_max_body_size 2g;
  location / { proxy_pass http://127.0.0.1:$API_PORT; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Real-IP \$remote_addr; proxy_request_buffering off; }
}
EOF
  nginx -t && systemctl reload nginx
  if ! is_ip_address "$PUBLIC_DOMAIN"; then /usr/local/bin/jtwz-domain route "$PUBLIC_DOMAIN"; fi
  if [[ "$ADMIN_DOMAIN" != "$PUBLIC_DOMAIN" ]] && ! is_ip_address "$ADMIN_DOMAIN"; then /usr/local/bin/jtwz-domain route "$ADMIN_DOMAIN"; fi
  say "Nginx 已配置：$PUBLIC_DOMAIN（管理入口：$ADMIN_DOMAIN$ADMIN_BASE_PATH/login）"
}

configure_firewall() {
  if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
    if [[ "$USE_REVERSE_PROXY" == 'true' ]]; then
      ufw allow 80/tcp >/dev/null
      ufw allow 443/tcp >/dev/null
      say 'UFW 已放行 HTTP/HTTPS 端口 80 和 443。'
    else
      ufw allow "$API_PORT/tcp" >/dev/null
      say "UFW 已放行 TCP 端口 $API_PORT。"
    fi
  elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
    if [[ "$USE_REVERSE_PROXY" == 'true' ]]; then
      firewall-cmd --permanent --add-service=http >/dev/null
      firewall-cmd --permanent --add-service=https >/dev/null
    else
      firewall-cmd --permanent --add-port="$API_PORT/tcp" >/dev/null
    fi
    firewall-cmd --reload >/dev/null
    [[ "$USE_REVERSE_PROXY" == 'true' ]] && say 'firewalld 已放行 HTTP/HTTPS 服务。' || say "firewalld 已放行 TCP 端口 $API_PORT。"
  else
    [[ "$USE_REVERSE_PROXY" == 'true' ]] && say '请确认云服务器安全组已放行 TCP 端口 80 和 443。' || say "请确认云服务器安全组已放行 TCP 端口 $API_PORT。"
  fi
}

verify_service() {
  local attempt
  for attempt in {1..20}; do
    if curl -fsS "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1; then
      say '服务健康检查通过。'
      return 0
    fi
    sleep 1
  done
  journalctl -u "$SERVICE_NAME" --no-pager -n 50 >&2 || true
  die "服务未能在 127.0.0.1:$API_PORT 正常启动，请根据上方日志检查。"
}

install_panel_runtime() {
  if [[ "$PANEL" == '1panel' && -f "$PACKAGE_DIR/docker-compose.yml" && -f "$PACKAGE_DIR/Dockerfile" ]]; then
    say '检测到 1Panel 包，写入 Compose 配置并启动容器。'
    cp -a "$PACKAGE_DIR/docker-compose.yml" "$APP_DIR/docker-compose.yml"
    cp -a "$PACKAGE_DIR/Dockerfile" "$APP_DIR/Dockerfile"
    (cd "$APP_DIR" && docker compose up -d --build)
  else
    write_systemd
    write_nginx
    configure_firewall
    verify_service
  fi
}

main() {
  local control_script=''
  say "JTWZ 安装向导（$PANEL）"
  if [[ -f "$ENV_FILE" && -s "$ENV_FILE" ]]; then EXISTING_INSTALL='true'; load_existing_env; else prompt_settings; fi
  validate_public_address "$PUBLIC_DOMAIN"
  validate_public_address "$ADMIN_DOMAIN"
  ADMIN_BASE_PATH="$(normalize_admin_base_path "$ADMIN_BASE_PATH")"
  install_reverse_proxy_tools
  select_access_mode
  install_application
  if [[ -f "$SCRIPT_DIR/jtwz-update" && -f "$SCRIPT_DIR/jtwz-update-dispatch" && -f "$SCRIPT_DIR/jtwz-domain" && -f "$SCRIPT_DIR/jtwz-domain-dispatch" && "$PANEL" != '1panel' ]]; then
    install -o root -g root -m 755 "$SCRIPT_DIR/jtwz-update" /usr/local/bin/jtwz-update
    install -o root -g root -m 755 "$SCRIPT_DIR/jtwz-update-dispatch" /usr/local/bin/jtwz-update-dispatch
    install -o root -g root -m 755 "$SCRIPT_DIR/jtwz-domain" /usr/local/bin/jtwz-domain
    install -o root -g root -m 755 "$SCRIPT_DIR/jtwz-domain-dispatch" /usr/local/bin/jtwz-domain-dispatch
    rm -f /etc/sudoers.d/jtwz-update
    write_update_dispatch_units
    write_domain_dispatch_units
  fi
  install_panel_runtime
  if [[ -f "$SCRIPT_DIR/jtwzctl" ]]; then
    control_script="$SCRIPT_DIR/jtwzctl"
  elif [[ -f "$PACKAGE_DIR/jtwzctl" ]]; then
    control_script="$PACKAGE_DIR/jtwzctl"
  fi
  if [[ -n "$control_script" ]]; then
    install -m 755 "$control_script" /usr/local/bin/jtwzctl
    ln -sfn /usr/local/bin/jtwzctl /usr/local/bin/jt
  else
    die '安装包缺少 jtwzctl 管理脚本。'
  fi
  say '安装完成。'
  say "公开首页：$PUBLIC_BASE_URL/"
  say "管理登录：$ADMIN_BASE_URL$ADMIN_BASE_PATH/login"
  say '交互管理：jt'
  say '查看状态：jt status'
  [[ "$USE_REVERSE_PROXY" == 'false' ]] && say "如果外网无法访问，请在云厂商安全组中放行 TCP 端口 $API_PORT。"
}

main "$@"
