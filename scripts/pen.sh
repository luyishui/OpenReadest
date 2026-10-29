#!/usr/bin/env bash
# pen.dev headless design helper
# Usage:
#   ./scripts/pen.sh new <file.pen> <script.txt>   — run script against new file
#   ./scripts/pen.sh edit <file.pen> <script.txt>  — run script against existing file
#   ./scripts/pen.sh export <file.pen> <nodeId> <outDir> [scale]
#   ./scripts/pen.sh html <file.pen> <nodeId> <out.html>
set -e
CMD=${1:?usage: new|edit|export|html}
shift
case "$CMD" in
  new)
    pen interactive -o "$1" < "$2" ;;
  edit)
    pen interactive -i "$1" -o "$1" < "$2" ;;
  export)
    SCALE=${4:-2}
    printf 'execute({ input: '"'"'Export(["%s"],"png","%s",{scale:%s})'"'"' })\nexit()\n' "$2" "$(realpath "$3")" "$SCALE" | pen interactive -i "$1" -o "$1" ;;
  html)
    printf 'execute({ input: '"'"'Export(["%s"],"html-tailwind","%s")'"'"' })\nexit()\n' "$2" "$(realpath "$3")" | pen interactive -i "$1" -o "$1" ;;
  *) echo "unknown: $CMD"; exit 1 ;;
esac
