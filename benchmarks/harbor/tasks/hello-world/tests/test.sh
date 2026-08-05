#!/bin/sh
set -eu
if [ -f /app/hello.txt ] && [ "$(cat /app/hello.txt)" = "Hello, world!" ]; then
  echo 1 > /logs/verifier/reward.txt
  exit 0
fi
echo 0 > /logs/verifier/reward.txt
exit 1
