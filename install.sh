#!/bin/bash
set -euo pipefail

install_workshop() (
  [[ "$(uname -s)" == Darwin ]] || { echo "Irudd Workshop requires macOS." >&2; return 1; }
  xcode-select -p >/dev/null 2>&1 || { echo "Run xcode-select --install, then run the installer again." >&2; return 1; }
  local root="${IRUDD_INSTALL_ROOT:-$HOME/Library/Application Support/Irudd Workshop Installer}"
  local applications="${IRUDD_APPLICATIONS_DIR:-$HOME/Applications}" bin="${IRUDD_BIN_DIR:-$HOME/.local/bin}"
  local origin="${IRUDD_REPOSITORY:-https://github.com/alundgren/irudd-game-tools.git}" branch="${IRUDD_BRANCH:-main}"
  local source="$root/source" link="$applications/Irudd Workshop.app" build vp version commit stage=""
  for path in "$root" "$applications" "$bin"; do
    [[ "$path" == /* && "$path" != / ]] || { echo "Install paths must be absolute directories." >&2; return 1; }
  done
  mkdir -p "$root/builds" "$applications" "$bin"
  mkdir "$root/.install-lock" || { echo "Another install owns $root/.install-lock. If interrupted, remove the empty lock directory and retry." >&2; return 1; }
  trap 'rmdir "$root/.install-lock"; if [[ -n "$stage" ]]; then rm -rf "$stage"; fi' EXIT
  if [[ -e "$link" || -L "$link" ]]; then
    [[ -L "$link" && "$(readlink "$link")" == "$root/builds/"*"/Irudd Workshop.app" ]] || { echo "Another application owns $link." >&2; return 1; }
  fi
  local command="$bin/irudd" target="$link/Contents/MacOS/irudd"
  if [[ -e "$command" || -L "$command" ]]; then
    [[ -L "$command" && "$(readlink "$command")" == "$target" ]] || { echo "Another command owns $command." >&2; return 1; }
  fi
  export GIT_TERMINAL_PROMPT=0 CI=true
  if [[ ! -d "$source/.git" ]]; then git clone --depth 1 --branch "$branch" -- "$origin" "$source"; fi
  [[ "$(git -C "$source" remote get-url origin)" == "$origin" && -z "$(git -C "$source" status --porcelain)" ]] || { echo "Check local edits and the Git remote in $source." >&2; return 1; }
  git -C "$source" fetch --depth 1 origin "$branch"
  commit="$(git -C "$source" rev-parse FETCH_HEAD)"
  git -C "$source" checkout --quiet --detach "$commit"
  build="$root/builds/$commit"
  if [[ ! -d "$build/Irudd Workshop.app" ]]; then
    stage="$(mktemp -d "$root/builds/.preparing.XXXXXX")"
    vp="${IRUDD_VP:-$(command -v vp || true)}"
    if [[ -z "$vp" || ! -x "$vp" ]]; then
      version="$(awk '/^  vite-plus: / {print $2; exit}' "$source/pnpm-workspace.yaml")"
      [[ -n "$version" ]] || { echo "Missing Vite+ version in pnpm-workspace.yaml." >&2; return 1; }
      curl -fsSL --connect-timeout 15 --max-time 120 https://vite.plus/install.sh -o "$stage/vite-install.sh"
      VP_HOME="$HOME/.vite-plus" VP_VERSION="$version" VP_NODE_MANAGER=no bash "$stage/vite-install.sh"
      vp="$HOME/.vite-plus/bin/vp"
    fi
    cd "$source"
    export PATH="$(dirname "$vp"):$PATH"
    "$vp" install --frozen-lockfile
    "$vp" -C apps/desktop exec install-electron
    "$vp" node --import ./packages/document/test/support/register.ts apps/desktop/scripts/package.ts --out "$stage/package"
    mv "$stage/package" "$build"
  fi
  local temp_link="$applications/.irudd-workshop-$$"
  ln -s "$build/Irudd Workshop.app" "$temp_link"
  mv -fh "$temp_link" "$link"
  if [[ ! -L "$command" ]]; then ln -s "$target" "$command"; fi
  echo "Installed $link. The command line tool is $command."
  if [[ "${IRUDD_NO_LAUNCH:-0}" != 1 ]]; then open "$link"; fi
)

install_workshop
