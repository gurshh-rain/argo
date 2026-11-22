#!/bin/sh
# Local-only run (no tunnel): http://localhost:4318
cd "$(dirname "$0")"
exec wasp start --client-port 4318 --server-port 4319 --client-url http://localhost:4318 --server-url http://localhost:4318/_server
