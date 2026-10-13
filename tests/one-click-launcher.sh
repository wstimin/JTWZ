#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIR="$(mktemp -d /tmp/jtwz-launcher-test.XXXXXX)"
trap 'rm -rf "$TEST_DIR"' EXIT

run_fixture() {
  local name="$1"
  local installer_path="$2"
  local fixture_root="$TEST_DIR/$name/package/jtwz-fixture"
  local archive="$TEST_DIR/$name/jtwz-fixture.tar.gz"
  local archive_url="file://$archive"
  local marker="$TEST_DIR/$name/executed"

  mkdir -p "$fixture_root/$(dirname "$installer_path")"
  cat > "$fixture_root/$installer_path" <<'INSTALLER'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${1:-}" == 'standalone' ]]
: "${JTWZ_TEST_MARKER:?}"
touch "$JTWZ_TEST_MARKER"
INSTALLER
  tar -C "$TEST_DIR/$name/package" -czf "$archive" jtwz-fixture
  if command -v cygpath >/dev/null 2>&1; then
    archive_url="file:///$(cygpath -w "$archive" | tr '\\' '/')"
  fi

  JTWZ_SOURCE_URL="$archive_url" JTWZ_TEST_MARKER="$marker" bash "$ROOT_DIR/deploy/one-click/install.sh"
  [[ -f "$marker" ]] || { printf 'fixture %s did not execute installer\n' "$name" >&2; exit 1; }
}

run_fixture release installer/install.sh
run_fixture source deploy/installer/install.sh
printf 'one-click launcher: release and source archive layouts passed\n'
