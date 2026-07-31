#!/bin/sh
set -eu

mkdir -p /home/node/.codex
chown -R node:node /home/node/.codex

export HOME=/home/node
export CODEX_HOME=/home/node/.codex

exec gosu node "$@"
