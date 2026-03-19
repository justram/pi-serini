#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"
pi_serini_cd_root
pi_serini_setup_java

JAR="${ANSERINI_FATJAR_PATH:-$PI_SERINI_ROOT/vendor/anserini/anserini-1.6.0-fatjar.jar}"
CLASSES_DIR="$PI_SERINI_ROOT/jvm/build/classes"

bash "$PI_SERINI_ROOT/scripts/build_bm25_server.sh"
exec java -cp "$CLASSES_DIR:$JAR" dev.jhy.piserini.Bm25Server "$@"
