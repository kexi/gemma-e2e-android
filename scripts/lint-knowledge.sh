#!/usr/bin/env bash
# knowledge/ の OKF v0.2 適合と tag 統制語彙を検証する。
#
# 検証するのは二つだけ:
#   1. 予約ファイル以外の全 .md が非空の `type` を持つ（OKF v0.2 §11 適合基準）
#   2. 使われている tag が knowledge/tags.yml に定義済み（ローカル規約）
#
# Why not 完全なスキーマ検証: 仕様は consumer に対し「未知のキー・未知の type・
#   任意フィールドの欠落を理由に bundle を拒否してはならない」と定めている。
#   厳格なスキーマ検証はその意図に反するので、適合基準そのものだけを見る。

set -uo pipefail

readonly BUNDLE="knowledge"
readonly TAGS_FILE="$BUNDLE/tags.yml"

if [[ ! -d "$BUNDLE" ]]; then
    echo "Skipped: $BUNDLE/ がない"
    exit 0
fi

# Skipping when yq is missing keeps a bare shell from failing on a machine that
# never opted into the devshell. CI sets REQUIRE_YQ=1 so the same absence is a
# failure there: a gate that silently checks nothing is worse than no gate.
if ! command -v yq >/dev/null 2>&1; then
    if [[ "${REQUIRE_YQ:-}" == "1" ]]; then
        echo "yq がない: CI では必須（REQUIRE_YQ=1）"
        exit 1
    fi
    echo "Skipped: yq がない（nix develop 内で実行する）"
    exit 0
fi

failed=0

# 1. OKF 適合: 非空の type
while IFS= read -r file; do
    case "$(basename "$file")" in
    index.md | log.md) continue ;;
    esac

    type_value=$(yq --front-matter=extract eval '.type // ""' "$file" 2>/dev/null)
    if [[ -z "$type_value" ]]; then
        echo "$file: 非空の type が必要（OKF v0.2 §11）"
        failed=1
    fi
done < <(find "$BUNDLE" -name '*.md')

# 2. tag 統制語彙
if [[ -f "$TAGS_FILE" ]]; then
    known=$(yq eval 'keys | .[]' "$TAGS_FILE")

    while IFS= read -r file; do
        case "$(basename "$file")" in
        index.md | log.md) continue ;;
        esac

        while IFS= read -r tag; do
            [[ -z "$tag" ]] && continue
            if ! grep -qx "$tag" <<<"$known"; then
                echo "$file: 未定義の tag \"$tag\"（$TAGS_FILE に説明付きで追加してから使う）"
                failed=1
            fi
        done < <(yq --front-matter=extract eval '.tags[]' "$file" 2>/dev/null)
    done < <(find "$BUNDLE" -name '*.md')
fi

exit "$failed"
