# provide-default-inputs-action

This is an action to get the default value of inputs.
Use this as a replacement value for events without inputs.

## Usage

```yaml
on:
  pull_request:
  workflow_dispatch:
    inputs:
      test:
        type: string
        default: 'hoge'
        required: false
      flag:
        type: boolean
        default: false
        required: false
      text:
        type: string
        required: false

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
    - uses: srz-zumix/provide-default-inputs-action@v1
      id: inputs-test
      with:
        name: test
    - uses: srz-zumix/provide-default-inputs-action@v1
      id: inputs-all
    - name: DoSomething
      env:
        INPUTS_TEST: ${{ inputs.test || steps.inputs-test.outputs.value }}
        INPUTS_FLAG: ${{ inputs.flag || steps.inputs-all.outputs.flag }}
        INPUTS_TEXT: ${{ inputs.text || steps.inputs-all.outputs.text }}
```

## Feature

### Check Diff

Outputs the difference between workflow_dispatch and workflow_call inputs as a summary.

![check-diff example](https://github.com/srz-zumix/provide-default-inputs-action/assets/1439172/eb7af48c-24e9-42e0-8ef2-49a91ea9b240)

## Development dependencies

Install with `npm ci`. Run `npm run format:check`, `npm run lint`,
`npm run ci-test`, and `npm run package` to validate changes.

The overrides in [package.json](./package.json) replace vulnerable transitive
versions of `glob` and `minimatch` with patched releases. Remove these overrides
when upstream dependencies require patched versions themselves.

`deepmerge` remains an unresolved development-only dependency of Jest and
`@rollup/plugin-node-resolve`:
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
No patched release is currently available. Retain the latest version rather than
downgrading to an older version merely to suppress the audit finding. Recheck the
advisory when updating dependencies. `npm audit` will continue to report this
issue; use `npm audit --omit=dev` to check runtime dependencies separately.
