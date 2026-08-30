#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
OUTPUT_DIR="${REPO_ROOT}/output/offline"
APPIMAGE_PATH=""
DEB_PATH=""
NODE_DEB_PATH=""
QCC_VERSION="1.0.8"
PYPI_INDEX_URL="https://mirrors.aliyun.com/pypi/simple"
BUNDLE_NAME="staix-mtclaw-ubuntu22.04-arm64-offline"

usage() {
  cat <<'EOF'
Usage: ./scripts/prepare-staix-aios-offline.sh [options]

Options:
  --appimage <path>      Required arm64 Staix AppImage.
  --deb <path>           Optional arm64 Staix DEB.
  --node-deb <path>      Optional arm64 NodeSource nodejs DEB; downloaded when omitted.
  --output-dir <path>    Output parent directory. Default: output/offline.
  --qcc-version <value>  qcc-agent-cli version. Default: 1.0.8.
  --pypi-index-url <url> HTTPS Python package index used while preparing the bundle.
  -h, --help             Show this help.

Run this script on Ubuntu 22.04 arm64 with network access. Credentials are never
copied into the public bundle.
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --appimage)
      [[ $# -ge 2 ]] || fail "--appimage requires a path"
      APPIMAGE_PATH="$2"
      shift 2
      ;;
    --deb)
      [[ $# -ge 2 ]] || fail "--deb requires a path"
      DEB_PATH="$2"
      shift 2
      ;;
    --node-deb)
      [[ $# -ge 2 ]] || fail "--node-deb requires a path"
      NODE_DEB_PATH="$2"
      shift 2
      ;;
    --output-dir)
      [[ $# -ge 2 ]] || fail "--output-dir requires a path"
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --qcc-version)
      [[ $# -ge 2 ]] || fail "--qcc-version requires a value"
      QCC_VERSION="$2"
      shift 2
      ;;
    --pypi-index-url)
      [[ $# -ge 2 ]] || fail "--pypi-index-url requires a URL"
      PYPI_INDEX_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown option: $1"
      ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || fail "this bundle must be prepared on Linux"
case "$(uname -m)" in
  aarch64|arm64) ;;
  *) fail "arm64 build host required; current architecture: $(uname -m)" ;;
esac

command -v python3 >/dev/null 2>&1 || fail "python3 is required"
command -v npm >/dev/null 2>&1 || fail "npm is required"
command -v dpkg-deb >/dev/null 2>&1 || fail "dpkg-deb is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
[[ -f "${REPO_ROOT}/MTClaw/pyproject.toml" ]] || fail "MTClaw source is missing"
[[ "$PYPI_INDEX_URL" == https://* ]] || fail "Python package index must use HTTPS: $PYPI_INDEX_URL"

export PIP_INDEX_URL="$PYPI_INDEX_URL"

if [[ -z "$APPIMAGE_PATH" ]]; then
  shopt -s nullglob
  appimage_candidates=("${REPO_ROOT}/packages/windows-client/release/"Staix-*-arm64.AppImage)
  shopt -u nullglob
  [[ ${#appimage_candidates[@]} -gt 0 ]] || fail "arm64 AppImage not found; pass --appimage <path>"
  APPIMAGE_PATH="${appimage_candidates[0]}"
fi
[[ -f "$APPIMAGE_PATH" ]] || fail "AppImage does not exist: $APPIMAGE_PATH"

if [[ -z "$DEB_PATH" ]]; then
  shopt -s nullglob
  deb_candidates=("${REPO_ROOT}/packages/windows-client/release/"Staix-*-arm64.deb)
  shopt -u nullglob
  if [[ ${#deb_candidates[@]} -gt 0 ]]; then
    DEB_PATH="${deb_candidates[0]}"
  fi
fi
[[ -z "$DEB_PATH" || -f "$DEB_PATH" ]] || fail "DEB does not exist: $DEB_PATH"

WORK_DIR=$(mktemp -d)
cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

BUNDLE_DIR="${OUTPUT_DIR}/${BUNDLE_NAME}"
rm -rf -- "$BUNDLE_DIR"
mkdir -p "${BUNDLE_DIR}/packages" "${BUNDLE_DIR}/offline/python-wheels"

install -m 0755 "$APPIMAGE_PATH" "${BUNDLE_DIR}/packages/$(basename "$APPIMAGE_PATH")"
if [[ -n "$DEB_PATH" ]]; then
  install -m 0644 "$DEB_PATH" "${BUNDLE_DIR}/packages/$(basename "$DEB_PATH")"
fi
install -m 0755 "${SCRIPT_DIR}/install-staix-aios.sh" "${BUNDLE_DIR}/install.sh"

python3 -m venv "${WORK_DIR}/wheel-venv"
"${WORK_DIR}/wheel-venv/bin/python" -m pip install --upgrade pip wheel
"${WORK_DIR}/wheel-venv/bin/python" -m pip wheel \
  --wheel-dir "${BUNDLE_DIR}/offline/python-wheels" \
  "${REPO_ROOT}/MTClaw"
"${WORK_DIR}/wheel-venv/bin/python" -m pip download \
  --only-binary=:all: \
  --dest "${BUNDLE_DIR}/offline/python-wheels" \
  pip

mkdir -p "${BUNDLE_DIR}/offline/qcc-runtime"
npm install \
  --prefix "${BUNDLE_DIR}/offline/qcc-runtime" \
  --omit=dev \
  --registry=https://registry.npmmirror.com \
  "qcc-agent-cli@${QCC_VERSION}"

if [[ -z "$NODE_DEB_PATH" ]]; then
  (
    cd "$WORK_DIR"
    apt-get download nodejs
  )
  shopt -s nullglob
  node_deb_candidates=("${WORK_DIR}/"nodejs_*_arm64.deb)
  shopt -u nullglob
  [[ ${#node_deb_candidates[@]} -gt 0 ]] || fail "apt-get download did not produce an arm64 nodejs DEB"
  NODE_DEB_PATH="${node_deb_candidates[0]}"
fi
[[ -f "$NODE_DEB_PATH" ]] || fail "Node.js DEB does not exist: $NODE_DEB_PATH"
[[ "$(dpkg-deb --field "$NODE_DEB_PATH" Architecture)" == "arm64" ]] || fail "Node.js DEB is not arm64"
mkdir -p "${BUNDLE_DIR}/offline/node-runtime"
dpkg-deb --extract "$NODE_DEB_PATH" "${BUNDLE_DIR}/offline/node-runtime"
[[ -x "${BUNDLE_DIR}/offline/node-runtime/usr/bin/node" ]] || fail "bundled Node.js executable is missing"

cat > "${BUNDLE_DIR}/README.txt" <<EOF
Staix + MTClaw offline bundle for Ubuntu 22.04 arm64

Public installation (no credentials):
  chmod +x ./install.sh
  ./install.sh --offline-only

Private demo profile installation:
  chmod +x ./install.sh
  ./install.sh --offline-only --profile /media/ubuntu/STAIX_PRIVATE/config.json

The private config.json is intentionally not included. Keep it off Git, use
temporary demo credentials, protect it with filesystem permissions, and revoke
the credentials after the event.
EOF

(
  cd "$BUNDLE_DIR"
  find . -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 sha256sum > SHA256SUMS
  sha256sum --check SHA256SUMS
)

mkdir -p "$OUTPUT_DIR"
ARCHIVE_PATH="${OUTPUT_DIR}/${BUNDLE_NAME}.tar.gz"
rm -f -- "$ARCHIVE_PATH"
tar -C "$OUTPUT_DIR" -czf "$ARCHIVE_PATH" "$BUNDLE_NAME"
(
  cd "$OUTPUT_DIR"
  sha256sum "$(basename "$ARCHIVE_PATH")" > "$(basename "$ARCHIVE_PATH").sha256"
)

echo "STAIX_OFFLINE_BUNDLE_PASS"
echo "Bundle directory: $BUNDLE_DIR"
echo "Archive: $ARCHIVE_PATH"
cat "${ARCHIVE_PATH}.sha256"
