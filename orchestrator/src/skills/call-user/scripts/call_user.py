#!/usr/bin/env python3
"""Pass one question to the existing phone CLI without a shell or retries."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    question = sys.stdin.read()
    if not question.strip():
        print("ERROR: question is empty; no call attempted.", file=sys.stderr)
        return 2
    backend = Path(os.environ.get("ARGO_PHONE_DEMO_DIR") or "/Users/gz/Documents/codevisor-call-demo").resolve()
    interpreter = backend / ".venv/bin/python"
    script = backend / "manual_call.py"
    if not interpreter.is_file() or not os.access(interpreter, os.X_OK) or not script.is_file():
        print("ERROR: phone backend unavailable; no call attempted.", file=sys.stderr)
        return 1
    try:
        with tempfile.TemporaryDirectory(prefix="argo-phone-question-") as directory:
            prompt = Path(directory) / "question.txt"
            descriptor = os.open(prompt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                output.write(question)
            return subprocess.run([str(interpreter), str(script), "--prompt-file", str(prompt)],
                                  stdin=subprocess.DEVNULL, cwd=backend).returncode
    except OSError:
        print("ERROR: local phone process failure; no automatic retry.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
