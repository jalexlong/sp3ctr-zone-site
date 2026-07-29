#!/usr/bin/env bash
# sp3ctr-zone :: test, build, ship
#
# A thin wrapper around `npm run deploy`. The pipeline underneath is unchanged —
# npm test, then npm run build (which wipes _site/ and re-runs Eleventy), then
# node deploy.mjs, which uploads _site/ to Neocities. What this adds is the
# things you'd otherwise have to remember every time:
#
#   the API key      read from the one *.env file next to this script, if it
#                    isn't already in the environment — so the key lives in a
#                    gitignored file instead of your shell history, and that
#                    file can be named for the site it opens: sp3ctr-zone.env.
#   the tests        run before anything is built or uploaded. Nothing ships
#                    from a red suite unless you say so out loud.
#   the flags        passed straight through, no `npm run deploy --` dance.
#   a confirmation   before a real --prune, which is the one step here that
#                    destroys anything.
#
#   ./ship.sh                      test, build, upload
#   ./ship.sh --prune              …and delete remote files the build dropped
#   ./ship.sh --prune --dry-run    show what --prune would delete, change
#                                  nothing
#   ./ship.sh --skip-tests         ship without running the suite
#   ./ship.sh --yes                don't ask before pruning

set -euo pipefail

# Run from the repo whatever directory it was invoked from, so paths below are
# the repo's and not the caller's.
cd "$(dirname "${BASH_SOURCE[0]}")"

prune=""
dry_run=""
skip_tests=""
assume_yes=""

# --help is the header comment above, minus the leading #, up to the first line
# that isn't one — so the two can't drift apart.
usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prune) prune="--prune" ;;
    --dry-run) dry_run="--dry-run" ;;
    --skip-tests) skip_tests="1" ;;
    -y | --yes) assume_yes="1" ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      echo >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

step() { printf '\n\033[35m:: %s\033[0m\n' "$1"; }

# The key, from the environment or from an env file beside this script — which
# is gitignored, and is the only place in the repo it should ever live. The file
# is sourced as shell, so it wants plain KEY=value lines.
#
# Any name ending in .env will do, so it can say which site it opens rather than
# being one more anonymous .env in a folder of them: sp3ctr-zone.env. That only
# works while there's exactly one of them, though — with two, picking either is
# a guess, and guessing which credentials to deploy with is how you end up
# publishing one site over another. So it says so and stops.
if [[ -z "${NEOCITIES_API_KEY:-}" ]]; then
  # nullglob so no match yields nothing rather than the literal pattern;
  # dotglob so a plain `.env` counts too, since * won't cross a leading dot.
  shopt -s nullglob dotglob
  env_files=()
  for candidate in *.env; do
    [[ -f "$candidate" ]] && env_files+=("$candidate")
  done
  shopt -u nullglob dotglob

  if ((${#env_files[@]} > 1)); then
    {
      echo "more than one env file here, and no way to tell which holds the key:"
      printf '  %s\n' "${env_files[@]}"
      echo
      echo "Keep one, or export NEOCITIES_API_KEY yourself and this is skipped."
    } >&2
    exit 1
  fi

  if ((${#env_files[@]} == 1)); then
    set -a
    # shellcheck disable=SC1090
    . "./${env_files[0]}"
    set +a
  fi
fi

if [[ -z "${NEOCITIES_API_KEY:-}" ]]; then
  cat >&2 <<'MSG'
NEOCITIES_API_KEY isn't set.

Get one at neocities.org/settings -> your site -> API Key, then either export it
or drop it in an env file next to this script — any name ending in .env, and
they're all gitignored:

  echo 'NEOCITIES_API_KEY=...' > sp3ctr-zone.env
MSG
  exit 1
fi

# Worth knowing before you ship, but not worth blocking on: what's about to go
# live is the working tree, committed or not.
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  printf '\033[33mnote:\033[0m uncommitted changes — deploying the working tree as it stands.\n'
fi

if [[ -z "$skip_tests" ]]; then
  step "tests"
  npm test
else
  printf '\033[33mnote:\033[0m skipping tests.\n'
fi

# Deleting from the live site is the only thing here that can't be undone by
# running the command again, so it's the only thing that asks first. A dry run
# deletes nothing and goes straight through.
if [[ -n "$prune" && -z "$dry_run" && -z "$assume_yes" ]]; then
  echo
  echo "--prune deletes files from the live site that this build no longer produces."
  echo "Run with --dry-run first to see the list."
  read -r -p "continue? [y/N] " reply
  [[ "$reply" =~ ^[Yy]$ ]] || {
    echo "nothing deployed."
    exit 1
  }
fi

step "build"
npm run build

step "deploy"
node deploy.mjs ${prune:+"$prune"} ${dry_run:+"$dry_run"}

