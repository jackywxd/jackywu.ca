#!/usr/bin/env bash
# 用 mock provider 跑某個 stack 的 tofu test。
# OpenTofu 在測試裡不支援 import 區塊（會直接 crash：「Importing is not supported in testing context」），
# 所以把 stack 複製到暫存目錄、去掉 imports*.tf 與 backend.tf 再測。import 本身由 plan 審（PR 留言裡的 <=import）。
#   用法：infra/scripts/tofu-test.sh infra/bootstrap
set -euo pipefail
stack="${1:?用法：tofu-test.sh <stack 目錄>}"
[ -d "$stack" ] || { echo "找不到 $stack" >&2; exit 2; }
infra_dir="$(cd "$stack/.." && pwd)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
dest="$tmp/$(basename "$stack")"
mkdir -p "$dest"
# 只複製設定、測試與 fixture；不帶 .terraform、本機 state
( cd "$stack" && find . -type f \( -name '*.tf' -o -name '*.tftest.hcl' -o -name '*.tfvars' -o -name '*.pem' -o -name '.terraform.lock.hcl' \) \
    ! -name 'imports*.tf' ! -name 'backend.tf' ! -path './.terraform/*' -print0 | rsync -a --from0 --files-from=- ./ "$dest/" )
# 共用檔（例如 live 讀的 ../worker-secrets.json）放在同樣的相對位置
find "$infra_dir" -maxdepth 1 -name '*.json' -exec cp {} "$tmp/" \;

export TF_PLUGIN_CACHE_DIR="${TF_PLUGIN_CACHE_DIR:-$HOME/.cache/opentofu-plugins}"
mkdir -p "$TF_PLUGIN_CACHE_DIR"
cd "$dest"
tofu init -backend=false -input=false -no-color >/dev/null
tofu test -no-color
