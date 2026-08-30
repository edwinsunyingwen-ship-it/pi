#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)
STAIX_PACKAGE=""
INSTALL_QCC="yes"
INSTALL_ROUTER="yes"
PREFLIGHT_ONLY="no"
OFFLINE_ONLY="no"
PROFILE_PATH=""
QCC_VERSION="1.0.8"
LOCAL_BIN="${HOME}/.local/bin"
STAIX_DATA_DIR="${HOME}/.local/share/staix"
ROUTER_VENV="${STAIX_DATA_DIR}/mtclaw-venv"
ROUTER_OFFLINE_RUNTIME="${STAIX_DATA_DIR}/mtclaw-runtime"
ROUTER_CONFIG="${HOME}/.function-router/config.json"
USER_UNIT_DIR="${HOME}/.config/systemd/user"
OFFLINE_DIR="${REPO_ROOT}/offline"
OFFLINE_WHEEL_DIR="${OFFLINE_DIR}/python-wheels"
OFFLINE_QCC_RUNTIME="${OFFLINE_DIR}/qcc-runtime"
OFFLINE_NODE_RUNTIME="${OFFLINE_DIR}/node-runtime"

usage() {
  cat <<'EOF'
Usage: ./scripts/install-staix-aios.sh [options]

Options:
  --package <path>       Staix .deb or .AppImage package. Auto-detected when omitted.
  --skip-qcc             Do not install qcc-agent-cli.
  --skip-router          Do not install the MTClaw Python runtime or user service.
  --preflight-only       Check the operating system and required commands, then exit.
  --offline-only         Refuse every npm, pip, or apt network fallback.
  --profile <path>       Import a private Staix config.json with mode 0600.
  --qcc-version <value>  qcc-agent-cli version. Default: 1.0.8.
  -h, --help             Show this help.

This installer never writes model, OCR, MCP, or qcc credentials.
EOF
}

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package)
      [[ $# -ge 2 ]] || fail "--package requires a path"
      STAIX_PACKAGE="$2"
      shift 2
      ;;
    --skip-qcc)
      INSTALL_QCC="no"
      shift
      ;;
    --skip-router)
      INSTALL_ROUTER="no"
      shift
      ;;
    --preflight-only)
      PREFLIGHT_ONLY="yes"
      shift
      ;;
    --offline-only)
      OFFLINE_ONLY="yes"
      shift
      ;;
    --profile)
      [[ $# -ge 2 ]] || fail "--profile requires a path"
      PROFILE_PATH="$2"
      shift 2
      ;;
    --qcc-version)
      [[ $# -ge 2 ]] || fail "--qcc-version requires a value"
      QCC_VERSION="$2"
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

if [[ -n "$PROFILE_PATH" ]]; then
  [[ -f "$PROFILE_PATH" ]] || fail "private profile does not exist: $PROFILE_PATH"
  PROFILE_PATH=$(cd "$(dirname "$PROFILE_PATH")" && pwd)/$(basename "$PROFILE_PATH")
fi

[[ "$(uname -s)" == "Linux" ]] || fail "this installer must run on Linux"
case "$(uname -m)" in
  x86_64|aarch64|arm64) ;;
  *) fail "unsupported CPU architecture: $(uname -m)" ;;
esac

if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
  echo "Detected system: ${PRETTY_NAME:-${ID:-unknown}} ($(uname -m))"
fi

command -v python3 >/dev/null 2>&1 || fail "python3 is required"
NODE_COMMAND=""
if command -v node >/dev/null 2>&1; then
  NODE_COMMAND=$(command -v node)
elif [[ -x "${OFFLINE_NODE_RUNTIME}/usr/bin/node" ]]; then
  NODE_COMMAND="${OFFLINE_NODE_RUNTIME}/usr/bin/node"
fi

if [[ "$INSTALL_QCC" == "yes" ]]; then
  [[ -n "$NODE_COMMAND" ]] || fail "Node.js is required for qcc; include offline/node-runtime or install Node.js 20+"
  NODE_MAJOR=$($NODE_COMMAND -p "Number(process.versions.node.split('.')[0])")
  [[ "$NODE_MAJOR" -ge 20 ]] || fail "Node.js 20 or newer is required; current: $($NODE_COMMAND --version)"
  if [[ ! -f "${OFFLINE_QCC_RUNTIME}/node_modules/qcc-agent-cli/bin/index.js" ]]; then
    [[ "$OFFLINE_ONLY" == "no" ]] || fail "offline qcc runtime is missing"
    command -v npm >/dev/null 2>&1 || fail "npm is required when offline qcc runtime is missing"
  fi
fi

if [[ "$PREFLIGHT_ONLY" == "yes" ]]; then
  echo "STAIX_AIOS_PREFLIGHT=PASS"
  if [[ -n "$NODE_COMMAND" ]]; then
    echo "Node.js: $($NODE_COMMAND --version)"
  else
    echo "Node.js: not required (--skip-qcc)"
  fi
  echo "Python: $(python3 --version 2>&1)"
  if command -v npm >/dev/null 2>&1; then
    echo "npm: $(npm --version)"
  elif [[ -f "${OFFLINE_QCC_RUNTIME}/node_modules/qcc-agent-cli/bin/index.js" ]]; then
    echo "npm: not required (offline qcc runtime present)"
  else
    echo "npm: not installed"
  fi
  echo "Offline-only: $OFFLINE_ONLY"
  exit 0
fi

if [[ "$OFFLINE_ONLY" == "yes" && -f "${REPO_ROOT}/SHA256SUMS" ]]; then
  command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required to verify the offline bundle"
  (
    cd "$REPO_ROOT"
    sha256sum --check SHA256SUMS
  ) || fail "offline bundle checksum verification failed"
  echo "STAIX_OFFLINE_CHECKSUMS=PASS"
fi

if [[ -z "$STAIX_PACKAGE" ]]; then
  shopt -s nullglob
  candidates=(
    "${REPO_ROOT}/packages/"Staix-*.AppImage
    "${REPO_ROOT}/packages/"Staix-*.deb
    "${REPO_ROOT}/packages/windows-client/release/"Staix-*.AppImage
    "${REPO_ROOT}/packages/windows-client/release/"Staix-*.deb
  )
  shopt -u nullglob
  [[ ${#candidates[@]} -gt 0 ]] || fail "no Staix .deb or .AppImage package found; pass --package <path>"
  STAIX_PACKAGE="${candidates[0]}"
fi

[[ -f "$STAIX_PACKAGE" ]] || fail "Staix package does not exist: $STAIX_PACKAGE"
STAIX_PACKAGE=$(cd "$(dirname "$STAIX_PACKAGE")" && pwd)/$(basename "$STAIX_PACKAGE")

mkdir -p "$LOCAL_BIN" "$STAIX_DATA_DIR"

case "$STAIX_PACKAGE" in
  *.deb)
    command -v sudo >/dev/null 2>&1 || fail "sudo is required to install a .deb package"
    if ! sudo dpkg -i "$STAIX_PACKAGE"; then
      [[ "$OFFLINE_ONLY" == "no" ]] || fail "DEB dependencies are missing; use the bundled AppImage or install dependencies before offline setup"
      sudo apt-get install -f -y
    fi
    ;;
  *.AppImage)
    APPIMAGE_TARGET="${STAIX_DATA_DIR}/Staix.AppImage"
    install -m 0755 "$STAIX_PACKAGE" "$APPIMAGE_TARGET"
    cat > "${LOCAL_BIN}/staix" <<EOF
#!/usr/bin/env bash
export APPIMAGE_EXTRACT_AND_RUN=1
exec "${APPIMAGE_TARGET}" "\$@"
EOF
    chmod 0755 "${LOCAL_BIN}/staix"
    ;;
  *)
    fail "unsupported Staix package type: $STAIX_PACKAGE"
    ;;
esac

if [[ -n "$PROFILE_PATH" ]]; then
  STAIX_CONFIG_DIR="${XDG_CONFIG_HOME:-${HOME}/.config}/Staix"
  STAIX_CONFIG_PATH="${STAIX_CONFIG_DIR}/config.json"
  mkdir -p "$STAIX_CONFIG_DIR"
  chmod 0700 "$STAIX_CONFIG_DIR"
  if [[ -f "$STAIX_CONFIG_PATH" ]]; then
    PROFILE_BACKUP="${STAIX_CONFIG_PATH}.backup.$(date +%Y%m%d%H%M%S)"
    cp -p "$STAIX_CONFIG_PATH" "$PROFILE_BACKUP"
    echo "Existing Staix profile backed up: $PROFILE_BACKUP"
  fi
  install -m 0600 "$PROFILE_PATH" "$STAIX_CONFIG_PATH"
  echo "Private Staix profile imported: $STAIX_CONFIG_PATH"
fi

if [[ "$INSTALL_ROUTER" == "yes" ]]; then
  if compgen -G "${OFFLINE_WHEEL_DIR}/*.whl" >/dev/null; then
    shopt -s nullglob
    pip_wheels=("${OFFLINE_WHEEL_DIR}/"pip-*.whl)
    shopt -u nullglob
    [[ ${#pip_wheels[@]} -gt 0 ]] || fail "offline pip wheel is missing"
    rm -rf "$ROUTER_OFFLINE_RUNTIME"
    mkdir -p "${ROUTER_OFFLINE_RUNTIME}/python-packages" "${ROUTER_OFFLINE_RUNTIME}/bin"
    PYTHONPATH="${pip_wheels[0]}" python3 -m pip install \
      --no-index \
      --find-links "$OFFLINE_WHEEL_DIR" \
      --target "${ROUTER_OFFLINE_RUNTIME}/python-packages" \
      "openclaw-function-router==1.0.0"
    cat > "${ROUTER_OFFLINE_RUNTIME}/bin/function-router" <<EOF
#!/usr/bin/env bash
export PYTHONPATH="${ROUTER_OFFLINE_RUNTIME}/python-packages"
exec python3 -m function_router.server "\$@"
EOF
    chmod 0755 "${ROUTER_OFFLINE_RUNTIME}/bin/function-router"
    ROUTER_COMMAND="${ROUTER_OFFLINE_RUNTIME}/bin/function-router"
  else
    [[ "$OFFLINE_ONLY" == "no" ]] || fail "offline MTClaw Python wheels are missing"
    [[ -f "${REPO_ROOT}/MTClaw/pyproject.toml" ]] || fail "MTClaw source is missing from the repository"
    python3 -m venv "$ROUTER_VENV" || fail "failed to create Python venv; install python3-venv first"
    "${ROUTER_VENV}/bin/python" -m pip install --upgrade pip
    "${ROUTER_VENV}/bin/python" -m pip install "${REPO_ROOT}/MTClaw"
    ROUTER_COMMAND="${ROUTER_VENV}/bin/function-router"
  fi

  mkdir -p "$USER_UNIT_DIR" "${HOME}/.function-router/logs"
  chmod 0700 "${HOME}/.function-router"
  cat > "${USER_UNIT_DIR}/staix-mtclaw-router.service" <<EOF
[Unit]
Description=Staix MTClaw Function Router
After=network-online.target
Wants=network-online.target
ConditionPathExists=%h/.function-router/config.json

[Service]
Type=simple
ExecStart=${ROUTER_COMMAND} --config %h/.function-router/config.json
Restart=on-failure
RestartSec=2
WorkingDirectory=%h/.function-router
StandardOutput=append:%h/.function-router/logs/router.out
StandardError=append:%h/.function-router/logs/router.out

[Install]
WantedBy=default.target
EOF

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload || true
    if [[ -f "$ROUTER_CONFIG" ]]; then
      chmod 0600 "$ROUTER_CONFIG"
      systemctl --user enable --now staix-mtclaw-router.service
    fi
  fi
fi

if [[ "$INSTALL_QCC" == "yes" ]]; then
  if [[ -f "${OFFLINE_QCC_RUNTIME}/node_modules/qcc-agent-cli/bin/index.js" ]]; then
    QCC_RUNTIME_TARGET="${STAIX_DATA_DIR}/qcc-runtime"
    NODE_RUNTIME_TARGET="${STAIX_DATA_DIR}/node-runtime"
    mkdir -p "$QCC_RUNTIME_TARGET" "$NODE_RUNTIME_TARGET"
    cp -a "${OFFLINE_QCC_RUNTIME}/." "$QCC_RUNTIME_TARGET/"
    cp -a "${OFFLINE_NODE_RUNTIME}/." "$NODE_RUNTIME_TARGET/"
    cat > "${LOCAL_BIN}/qcc" <<EOF
#!/usr/bin/env bash
exec "${NODE_RUNTIME_TARGET}/usr/bin/node" "${QCC_RUNTIME_TARGET}/node_modules/qcc-agent-cli/bin/index.js" "\$@"
EOF
    chmod 0755 "${LOCAL_BIN}/qcc"
  else
    [[ "$OFFLINE_ONLY" == "no" ]] || fail "offline qcc runtime is missing"
    npm install --global --prefix "${HOME}/.local" "qcc-agent-cli@${QCC_VERSION}"
  fi
fi

echo
echo "Staix AIOS installation completed."
echo "Staix package: $STAIX_PACKAGE"
echo "Local commands: $LOCAL_BIN"
if [[ "$INSTALL_ROUTER" == "yes" ]]; then
  echo "MTClaw runtime command: $ROUTER_COMMAND"
  if [[ -f "$ROUTER_CONFIG" ]]; then
    echo "Router configuration found; the user service was started."
  else
    echo "Router configuration is not present yet. Configure models and MTClaw in Staix before starting the service."
  fi
fi
if [[ "$INSTALL_QCC" == "yes" ]]; then
  echo "qcc-agent-cli: ${QCC_VERSION} (authorization is intentionally not configured by the public installer)"
fi
echo "Credential policy: no model, OCR, MCP, or qcc credential was written by this installer."
if [[ -n "$PROFILE_PATH" ]]; then
  echo "Private profile: imported from the explicitly supplied file; keep that file off Git and revoke temporary demo credentials after the event."
fi
echo "If ${LOCAL_BIN} is not on PATH, run: export PATH=\"${LOCAL_BIN}:\$PATH\""
