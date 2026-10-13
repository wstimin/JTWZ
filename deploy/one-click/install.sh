#!/usr/bin/env bash
set -Eeuo pipefail

# JTWZ 一键部署入口：既支持 Release 压缩包，也支持远程一行命令。
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_INSTALLER="$SCRIPT_DIR/installer/install.sh"

if [[ -f "$LOCAL_INSTALLER" ]]; then
  exec bash "$LOCAL_INSTALLER" standalone "$@"
fi

command -v curl >/dev/null || { printf '[JTWZ] 缺少 curl，无法下载安装包。\n' >&2; exit 1; }
command -v tar >/dev/null || { printf '[JTWZ] 缺少 tar，无法解压安装包。\n' >&2; exit 1; }

SOURCE_URL="${JTWZ_SOURCE_URL:-}"
TMP_DIR="$(mktemp -d /tmp/jtwz-one-click.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

printf '\n[JTWZ] 一键部署启动器 revision 20261013.4\n'
if [[ -z "$SOURCE_URL" ]]; then
  RELEASE_JSON="$(curl -fsSL --connect-timeout 10 --max-time 30 -H 'Accept: application/vnd.github+json' 'https://api.github.com/repos/wstimin/JTWZ/releases/latest' || true)"
  RELEASE_TAG="$(printf '%s' "$RELEASE_JSON" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  if [[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
    SOURCE_URL="https://github.com/wstimin/JTWZ/releases/download/$RELEASE_TAG/jtwz-one-click-$RELEASE_TAG.tar.gz"
    printf '[JTWZ] 下载最新正式安装包：%s\n' "$RELEASE_TAG"
  else
    SOURCE_URL='https://github.com/wstimin/JTWZ/archive/refs/heads/main.tar.gz'
    printf '[JTWZ] 未找到正式 Release，改用 main 源码安装\n'
  fi
fi
printf '[JTWZ] 下载并准备一键安装\n'
curl -fL --retry 3 --connect-timeout 10 "$SOURCE_URL" -o "$TMP_DIR/jtwz-source.tar.gz"
tar -xzf "$TMP_DIR/jtwz-source.tar.gz" -C "$TMP_DIR"
DOWNLOADED_INSTALLER="$(find "$TMP_DIR" -path '*/deploy/installer/install.sh' -type f -print -quit)"
[[ -n "$DOWNLOADED_INSTALLER" ]] || { printf '[JTWZ] 安装包结构不完整：缺少 installer/install.sh。\n' >&2; exit 1; }
chmod u+x "$DOWNLOADED_INSTALLER"
bash "$DOWNLOADED_INSTALLER" standalone "$@"
