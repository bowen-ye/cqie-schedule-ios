#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SOURCE_DIR="$SCRIPT_DIR/../prototype"
TARGET_DIR="$SCRIPT_DIR/Kebiao/www"

mkdir -p "$TARGET_DIR"
cp "$SOURCE_DIR/index.html" "$TARGET_DIR/index.html"
cp "$SOURCE_DIR/style.css" "$TARGET_DIR/style.css"
cp "$SOURCE_DIR/app.js" "$TARGET_DIR/app.js"
echo "Synced prototype web assets to ios/Kebiao/www"
