#!/bin/bash
set -euo pipefail

export BUILD_DIR="${BUILD_DIR:-/workspace/gb10-wheels}"
exec bash "$(dirname "$0")/build-attention-wheels.sh" all
