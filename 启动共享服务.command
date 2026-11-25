#!/bin/zsh
cd -- "$(dirname -- "$0")" || exit 1
runtime_python="/Users/aidan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
if [[ -x "$runtime_python" ]]; then
  "$runtime_python" server.py
elif command -v python3 >/dev/null 2>&1; then
  python3 server.py
else
  echo '需要 Python 3.10 或更新版本。安装后运行 python3 server.py。'
fi
printf '\n服务已停止。按回车关闭。'
read
