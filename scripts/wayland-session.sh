#!/usr/bin/env bash
# A throwaway Wayland compositor for gpuix windows on Linux (FKN-26): a
# headless sway (wlroots' headless backend: no screen, no DRM seat, no input
# devices), run only while one command does, then killed. Nothing appears on
# anyone's screen, and nothing here touches the session you're logged in to.
#
#   scripts/wayland-session.sh [--size 1280x800] [--shots DIR] -- COMMAND...
#
# COMMAND runs with WAYLAND_DISPLAY set to the new compositor's socket and
# DISPLAY unset (so GPUI can't fall back to X11 on your desktop). Also set:
#   FKN_SWAYSOCK        the compositor's IPC socket: `swaymsg -s "$FKN_SWAYSOCK" ...`
#   FKN_WAYLAND_OUTPUT  the output's name, for `output NAME power off|on`
#   FKN_WAYLAND_SHOTS   a folder for compositor screenshots (grim)
#   FKN_LINUX_WINDOWS=1 the window tests may run (see test/support/windows.ts)
# sway and grim come from PATH (FKN_SWAY / FKN_GRIM name other ones).
#
# Why a headless compositor: gpuix 0.10 can't read frames back on Linux, so
# pixels come from the compositor (grim). And a headless output can't sleep:
# on a desktop whose display has gone to sleep (DPMS off) the compositor stops
# sending frame callbacks, so a window there doesn't paint for automation.
# Tiled with no gaps or borders, one window fills the output exactly.
set -euo pipefail

size=1280x800
shots=""
usage() { echo "usage: $0 [--size WxH] [--shots DIR] -- COMMAND..." >&2; exit 2; }
while [[ $# -gt 0 ]]; do
  case "$1" in
    --size) size="${2:?}"; shift 2 ;;
    --shots) shots="${2:?}"; shift 2 ;;
    --) shift; break ;;
    *) usage ;;
  esac
done
[[ $# -gt 0 ]] || usage
[[ "$(uname -s)" == Linux ]] || { echo "wayland-session: Linux only" >&2; exit 2; }
sway="${FKN_SWAY:-sway}"
swaymsg="${FKN_SWAYMSG:-$(dirname "$(command -v "$sway" || echo "$sway")")/swaymsg}"
grim="${FKN_GRIM:-grim}"
command -v "$sway" >/dev/null || { echo "wayland-session: sway is not installed (FKN_SWAY names one)" >&2; exit 2; }
[[ -x "$swaymsg" ]] || swaymsg="$(command -v swaymsg)"
command -v "$grim" >/dev/null || { echo "wayland-session: grim is not installed (FKN_GRIM names one)" >&2; exit 2; }

runtime="${XDG_RUNTIME_DIR:?XDG_RUNTIME_DIR must be set}"
live_wayland="${WAYLAND_DISPLAY:-}"
work="$(mktemp -d "${TMPDIR:-/tmp}/fkn-wayland-session.XXXXXX")"
shots="${shots:-$work/shots}"
mkdir -p "$shots"

# No `include`, no exec-once, no bar: nothing that reaches the real session
# (sway's stock config imports the environment into systemd and dbus).
cat > "$work/sway.conf" <<EOF
output HEADLESS-1 resolution $size position 0 0
default_border none
default_floating_border none
gaps inner 0
gaps outer 0
focus_follows_mouse no
EOF

pid=""
cleanup() {
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.25
    done
    kill -KILL "$pid" 2>/dev/null || true
  fi
  [[ -n "${KEEP_WORK:-}" ]] || rm -rf "$work"
}
trap cleanup EXIT

# WLR_BACKENDS=headless: no DRM, no parent compositor, no window anywhere.
# The live session's variables are removed so nothing can reach it.
env -u WAYLAND_DISPLAY -u DISPLAY -u SWAYSOCK -u I3SOCK -u HYPRLAND_INSTANCE_SIGNATURE \
  WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 \
  "$sway" --config "$work/sway.conf" > "$work/sway.log" 2>&1 &
pid=$!
ipc="$runtime/sway-ipc.$(id -u).$pid.sock"

for _ in $(seq 1 100); do
  kill -0 "$pid" 2>/dev/null || { echo "wayland-session: sway exited at start:" >&2; tail -20 "$work/sway.log" >&2; exit 1; }
  [[ -S "$ipc" ]] && "$swaymsg" -s "$ipc" -t get_outputs >/dev/null 2>&1 && break
  sleep 0.1
done
[[ -S "$ipc" ]] || { echo "wayland-session: sway has no IPC socket" >&2; tail -20 "$work/sway.log" >&2; exit 1; }

# The socket sway's clients use: ask sway, as its own child says.
"$swaymsg" -s "$ipc" -q exec "printf %s \"\$WAYLAND_DISPLAY\" > $work/socket"
for _ in $(seq 1 50); do [[ -s "$work/socket" ]] && break; sleep 0.1; done
socket="$(cat "$work/socket" 2>/dev/null || true)"
[[ -n "$socket" ]] || { echo "wayland-session: could not learn sway's socket" >&2; exit 1; }
if [[ "$socket" == "$live_wayland" ]]; then
  echo "wayland-session: refusing: the new compositor is the live session ($socket)" >&2
  exit 1
fi
output="$("$swaymsg" -s "$ipc" -t get_outputs -r | grep -o '"name": *"[^"]*"' | head -1 | sed 's/.*: *"\(.*\)"/\1/')"
[[ -n "$output" ]] || { echo "wayland-session: the compositor has no output" >&2; exit 1; }
echo "wayland-session: $socket, output $output ($size), sway pid $pid" >&2

set +e
env -u DISPLAY -u HYPRLAND_INSTANCE_SIGNATURE \
  WAYLAND_DISPLAY="$socket" FKN_SWAYSOCK="$ipc" FKN_WAYLAND_OUTPUT="$output" FKN_WAYLAND_SHOTS="$shots" \
  FKN_LINUX_WINDOWS=1 "$@"
status=$?
set -e
echo "wayland-session: command exited $status; stopping the compositor" >&2
exit "$status"
