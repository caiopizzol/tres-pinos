#!/bin/sh
# Turns screenshots into one GIF for a guide, in the order given, each centered on the same canvas for 2.5 seconds.
#
#   sh screens-to-gif.sh <out.gif> <screen.png>...
#
# Needs ffmpeg.
set -eu
out=$1
shift
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
i=0
for screen in "$@"; do
  i=$((i + 1))
  ffmpeg -v error -i "$screen" \
    -vf "scale=960:540:force_original_aspect_ratio=decrease,pad=1000:580:(ow-iw)/2:(oh-ih)/2:color=#F3F4F8,format=rgb24" \
    "$work/$(printf %02d "$i").png"
done
# Each screen is shown 2.5 s; the list repeats the last one, since the concat demuxer ignores the last duration.
for f in "$work"/*.png; do printf "file '%s'\nduration 2.5\n" "$f"; done >"$work/list.txt"
printf "file '%s'\n" "$f" >>"$work/list.txt"
ffmpeg -v error -y -f concat -safe 0 -i "$work/list.txt" -loop 0 \
  -vf "fps=2,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" "$out"
echo "$out"
