#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"
case_id="$(printf '%s' "$input" | jq -r '.case_id // empty')"

if [ -z "$case_id" ]; then
	printf '%s\n' '{"error":"missing case_id"}'
	exit 1
fi

jq -n \
	--arg case_id "$case_id" \
	'{
		result: "ok",
		case_id: $case_id,
		status: "materials_received",
		processed_files: 3,
		pending_files: 1,
		tool_output: ("案件 " + $case_id + " 已接收材料，已处理 3 份，待处理 1 份。")
	}'
