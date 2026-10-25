#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
gh workflow run docker-build.yml --ref main
echo "已触发 main 分支的 x86 和 ARM 镜像构建。"
