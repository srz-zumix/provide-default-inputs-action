#!/bin/bash

set -euo pipefail

TEMP_DIR="${RUNNER_TEMP:-./tmp}/provide-default-inputs"
DOWNLOAD_YAMLFILE="${TEMP_DIR}/provide-default-inputs-download.yml"
DOWNLOAD_JSONDIR="${TEMP_DIR}/provide-default-inputs-download-jsons"
DEFAULT_INPUTS_JSON="${TEMP_DIR}/provide-default-inputs.json"
WORKFLOW="${GITHUB_WORKFLOW:-$1}"
WORKFLOW_REF=${GITHUB_SHA:-$(git branch --show-current)}
SELECT_EVENT=${INPUTS_SELECT_EVENT:-}
SELECT_KEYNAME=${INPUTS_NAME:-${2:-}}

WORKFLOW_DOWNLOAD_OPTIONS=("${WORKFLOW}" --yaml --ref "${WORKFLOW_REF}")
if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    WORKFLOW_DOWNLOAD_OPTIONS+=("--repo" "${GITHUB_REPOSITORY:-}")
fi

mkdir -p "${DOWNLOAD_JSONDIR}"

to_default_inputs_json() {
    cat - \
        | jq '.inputs | to_entries | .[] | {(.key): ( if(.value.default != null) then .value.default else empty end )}' \
        | jq -s 'add'
}

if [ ! -f "${DOWNLOAD_YAMLFILE}" ]; then
    gh workflow view "${WORKFLOW_DOWNLOAD_OPTIONS[@]}" > "${DOWNLOAD_YAMLFILE}"
    yq -o json "${DOWNLOAD_YAMLFILE}" > "${DOWNLOAD_JSONDIR}/download.json"
    HAS_KEY=$(jq '.on | has("workflow_dispatch")' < "${DOWNLOAD_JSONDIR}/download.json")
    if [ "${HAS_KEY}" == 'true' ]; then
        jq '.on.workflow_dispatch' < "${DOWNLOAD_JSONDIR}/download.json" \
            | to_default_inputs_json > "${DOWNLOAD_JSONDIR}/workflow_dispatch.json"
    fi
    HAS_KEY=$(jq '.on | has("workflow_call")' < "${DOWNLOAD_JSONDIR}/download.json")
    if [ "${HAS_KEY}" == 'true' ]; then
        jq '.on.workflow_call' < "${DOWNLOAD_JSONDIR}/download.json" \
            | to_default_inputs_json > "${DOWNLOAD_JSONDIR}/workflow_call.json"
    fi
fi

if [ -f "${DOWNLOAD_JSONDIR}/workflow_dispatch.json" ]; then
    SELECT_EVENT=${SELECT_EVENT:-workflow_dispatch}
elif [ -f "${DOWNLOAD_JSONDIR}/workflow_call.json" ]; then
    SELECT_EVENT=${SELECT_EVENT:-workflow_call}
fi

if [ -f "${DOWNLOAD_JSONDIR}/${SELECT_EVENT}.json" ]; then
    cp "${DOWNLOAD_JSONDIR}/${SELECT_EVENT}.json" "${DEFAULT_INPUTS_JSON}"
else
    echo '{}' > "${DEFAULT_INPUTS_JSON}"
fi

if [ -f "${GITHUB_EVENT_PATH:-}" ]; then
    if [ ! -f "${DOWNLOAD_JSONDIR}/inputs.json" ]; then
        HAS_KEY=$(jq 'has("inputs")' < "${GITHUB_EVENT_PATH:-}")
        if [ "${HAS_KEY}" == 'true' ]; then
            jq '.inputs'  < "${GITHUB_EVENT_PATH:-}" > "${DOWNLOAD_JSONDIR}/inputs.json"
        fi
    fi
fi

INPUTS_JSON="${DEFAULT_INPUTS_JSON}"
if [ -f "${DOWNLOAD_JSONDIR}/inputs.json" ]; then
    INPUTS_JSON="${DOWNLOAD_JSONDIR}/inputs.json"
fi

OUTPUTS_VALUE=$(jq -r ".${SELECT_KEYNAME}" < "${DEFAULT_INPUTS_JSON}")
if [ -z "${SELECT_KEYNAME}" ]; then
    OUTPUTS_VALUE=$(jq -c < "${INPUTS_JSON}")
else
    OUTPUTS_VALUE=$(jq -r ".${SELECT_KEYNAME}" < "${INPUTS_JSON}")
fi

echo "json=${DEFAULT_INPUTS_JSON}" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
echo "value=${OUTPUTS_VALUE}" | tee -a "${GITHUB_OUTPUT:-/dev/null}"
