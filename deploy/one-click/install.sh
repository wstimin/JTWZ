#!/usr/bin/env bash
set -Eeuo pipefail

# JTWZ 一键部署入口：既支持 Release 压缩包，也支持远程一行命令。
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_INSTALLER="$SCRIPT_DIR/installer/install.sh"

if [[ -f "$LOCAL_INSTALLER" ]]; then
  exec "$LOCAL_INSTALLER" standalone "$@"
fi

command -v curl >/dev/null || { printf '[JTWZ] 缺少 curl，无法下载安装包。\n' >&2; exit 1; }
command -v tar >/dev/null || { printf '[JTWZ] 缺少 tar，无法解压安装包。\n' >&2; exit 1; }

SOURCE_URL="${JTWZ_SOURCE_URL:-https://github.com/wstimin/JTWZ/archive/refs/heads/main.tar.gz}"
TMP_DIR="$(mktemp -d /tmp/jtwz-one-click.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

printf '\n[JTWZ] 下载 JTWZ 最新源码并准备一键安装\n'
curl -fL --retry 3 --connect-timeout 10 "$SOURCE_URL" -o "$TMP_DIR/jtwz-source.tar.gz"
tar -xzf "$TMP_DIR/jtwz-source.tar.gz" -C "$TMP_DIR"
DOWNLOADED_INSTALLER="$(find "$TMP_DIR" -path '*/deploy/installer/install.sh' -type f -print -quit)"
[[ -n "$DOWNLOADED_INSTALLER" ]] || { printf '[JTWZ] 安装包结构不完整：缺少 installer/install.sh。\n' >&2; exit 1; }
exec "$DOWNLOADED_INSTALLER" standalone "$@"
