#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_DIR="$SCRIPT_DIR/../prototype"
TARGET_DIR="$SCRIPT_DIR/Kebiao/www"

mkdir -p "$TARGET_DIR"
cp "$SOURCE_DIR/index.html" "$TARGET_DIR/index.html"
cp "$SOURCE_DIR/home-install.html" "$TARGET_DIR/home-install.html"
cp "$SOURCE_DIR/style.css" "$TARGET_DIR/style.css"
cp "$SOURCE_DIR/app.js" "$TARGET_DIR/app.js"
cp "$SOURCE_DIR/manifest.webmanifest" "$TARGET_DIR/manifest.webmanifest"
cp "$SOURCE_DIR/service-worker.js" "$TARGET_DIR/service-worker.js"
mkdir -p "$TARGET_DIR/icons"
cp "$SOURCE_DIR/icons/icon-192.png" "$TARGET_DIR/icons/icon-192.png"
cp "$SOURCE_DIR/icons/icon-512.png" "$TARGET_DIR/icons/icon-512.png"
echo "Synced prototype web assets to ios/Kebiao/www"
