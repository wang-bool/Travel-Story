#!/usr/bin/env bash
# ============================================================
# Travel Story — 一键下载 OpenFreeMap 整球 MBTiles（约 95GB）
#
# 用法：
#   scripts/download-planet.sh                 # 下载默认版本
#   scripts/download-planet.sh 20260816_080001_pt   # 指定版本
#
# 最新版本号见 https://btrfs.openfreemap.com/files.txt
# 下载支持断点续传（中断了重跑同一命令即可），完成后放至
# tile-cache/planet.mbtiles，/api/tiles 代理下次请求自动生效
# （无需重启，MBTiles 是懒打开的）。
# ============================================================
set -euo pipefail

VERSION="${1:-20260816_080001_pt}"
URL="https://btrfs.openfreemap.com/areas/planet/${VERSION}/tiles.mbtiles"
DIR="$(cd "$(dirname "$0")/.." && pwd)/tile-cache"
TARGET="$DIR/planet.mbtiles"

mkdir -p "$DIR"
echo "→ 下载 $URL"
echo "  目标 $TARGET（约 95GB，-C - 断点续传）"
curl -C - -L --retry 5 --retry-delay 5 -o "$TARGET.part" "$URL"
mv "$TARGET.part" "$TARGET"
echo "✓ 完成：$TARGET"
echo "  刷新页面即生效（底图需处于「国际」模式）。"
