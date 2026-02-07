#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  cat <<'EOF'
Usage:
  ./playwright_scripts/run_on_existing_x_session.sh [command...]

Description:
  Finds an existing X session environment from a process owned by the current
  user, exports the relevant variables, and runs the provided command.

Defaults:
  If no command is provided, runs:
    npm run test:e2e:headed

Notes:
  - Same-user processes only.
  - Fails if no X DISPLAY is found.
EOF
  exit 0
fi

CURRENT_UID="$(id -u)"
CURRENT_USER="$(id -un)"

read_env_var() {
  local pid="$1"
  local key="$2"
  local env_content
  env_content="$( (tr '\0' '\n' <"/proc/${pid}/environ") 2>/dev/null || true )"
  if [[ -z "${env_content}" ]]; then
    return 0
  fi
  printf '%s\n' "${env_content}" \
    | sed -n "s/^${key}=//p" \
    | head -n1
}

pid_uid_matches_current() {
  local pid="$1"
  local uid
  uid="$(awk '/^Uid:/{print $2; exit}' "/proc/${pid}/status" 2>/dev/null || true)"
  [[ -n "${uid}" && "${uid}" == "${CURRENT_UID}" ]]
}

choose_highest_pid() {
  if [[ "$#" -eq 0 ]]; then
    return 1
  fi
  printf '%s\n' "$@" | sort -n | tail -n1
}

declare -a preferred_pids=()
declare -a fallback_pids=()

for proc_dir in /proc/[0-9]*; do
  pid="${proc_dir##*/}"
  if [[ ! -r "${proc_dir}/environ" || ! -r "${proc_dir}/status" ]]; then
    continue
  fi
  if ! pid_uid_matches_current "${pid}"; then
    continue
  fi

  display_value="$(read_env_var "${pid}" "DISPLAY")"
  if [[ -z "${display_value}" ]]; then
    continue
  fi

  comm_name="$(cat "${proc_dir}/comm" 2>/dev/null || true)"
  case "${comm_name}" in
    gnome-shell|plasmashell|xfce4-session|cinnamon-session|mate-session|lxqt-session|kwin_x11|Xorg)
      preferred_pids+=("${pid}")
      ;;
    *)
      fallback_pids+=("${pid}")
      ;;
  esac
done

selected_pid=""
if [[ "${#preferred_pids[@]}" -gt 0 ]]; then
  selected_pid="$(choose_highest_pid "${preferred_pids[@]}")"
elif [[ "${#fallback_pids[@]}" -gt 0 ]]; then
  selected_pid="$(choose_highest_pid "${fallback_pids[@]}")"
fi

if [[ -z "${selected_pid}" ]]; then
  echo "No existing X session environment found for user '${CURRENT_USER}'." >&2
  exit 1
fi

DISPLAY_VALUE="$(read_env_var "${selected_pid}" "DISPLAY")"
if [[ -z "${DISPLAY_VALUE}" ]]; then
  echo "Selected PID ${selected_pid} did not provide DISPLAY." >&2
  exit 1
fi

XAUTHORITY_VALUE="$(read_env_var "${selected_pid}" "XAUTHORITY")"
DBUS_VALUE="$(read_env_var "${selected_pid}" "DBUS_SESSION_BUS_ADDRESS")"
XDG_RUNTIME_DIR_VALUE="$(read_env_var "${selected_pid}" "XDG_RUNTIME_DIR")"
WAYLAND_DISPLAY_VALUE="$(read_env_var "${selected_pid}" "WAYLAND_DISPLAY")"

if [[ -z "${XAUTHORITY_VALUE}" && -f "${HOME}/.Xauthority" ]]; then
  XAUTHORITY_VALUE="${HOME}/.Xauthority"
fi

export DISPLAY="${DISPLAY_VALUE}"
if [[ -n "${XAUTHORITY_VALUE}" ]]; then
  export XAUTHORITY="${XAUTHORITY_VALUE}"
fi
if [[ -n "${DBUS_VALUE}" ]]; then
  export DBUS_SESSION_BUS_ADDRESS="${DBUS_VALUE}"
fi
if [[ -n "${XDG_RUNTIME_DIR_VALUE}" ]]; then
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR_VALUE}"
fi
if [[ -n "${WAYLAND_DISPLAY_VALUE}" ]]; then
  export WAYLAND_DISPLAY="${WAYLAND_DISPLAY_VALUE}"
fi

echo "Using existing X session from PID ${selected_pid} (DISPLAY=${DISPLAY_VALUE})"
if [[ -n "${XAUTHORITY_VALUE}" ]]; then
  echo "Using XAUTHORITY=${XAUTHORITY_VALUE}"
fi

if [[ "$#" -eq 0 ]]; then
  set -- npm run test:e2e:headed
fi

exec "$@"
