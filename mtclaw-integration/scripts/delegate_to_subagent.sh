#!/usr/bin/env bash
set -euo pipefail

input="$(cat)"

jq -n \
	--argjson request "${input:-{}}" \
	'{
		error: "delegate_to_subagent must be delegated to the Staix pi-agent Runtime",
		request: $request
	}'

exit 1
