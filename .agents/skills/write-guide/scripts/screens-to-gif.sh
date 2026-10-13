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
  # Laid over the canvas color, so a screenshot with transparency doesn't turn black.
  ffmpeg -v error -f lavfi -i "color=c=#F3F4F8:s=1000x580" -i "$screen" -filter_complex \
    "[1]scale=960:540:force_original_aspect_ratio=decrease[s];[0][s]overlay=(W-w)/2:(H-h)/2:shortest=1,format=rgb24" \
    -frames:v 1 "$work/$(printf %02d "$i").png"
done
# Each screen is shown 2.5 s; the list repeats the last one, since the concat demuxer ignores the last duration.
for f in "$work"/*.png; do printf "file '%s'\nduration 2.5\n" "$f"; done >"$work/list.txt"
printf "file '%s'\n" "$f" >>"$work/list.txt"
ffmpeg -v error -y -f concat -safe 0 -i "$work/list.txt" -loop 0 \
  -vf "fps=2,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" "$out"
echo "$out"
