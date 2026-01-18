# provide-default-inputs-action

This is an action to get the default value of inputs.
Use this as a replacement value for events without inputs.

## Usage

### Direct Output Access (Recommended)

When calling the action without specifying a specific input name, individual outputs are automatically created for common input keys (test, flag, text):

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
    - uses: srz-zumix/provide-default-inputs-action@v0
      id: inputs-all
    - name: DoSomething
      env:
        INPUTS_TEST: ${{ inputs.test || steps.inputs-all.outputs.test }}
        INPUTS_FLAG: ${{ inputs.flag || steps.inputs-all.outputs.flag }}
        INPUTS_TEXT: ${{ inputs.text || steps.inputs-all.outputs.text }}
```

### Alternative: JSON Parsing

You can also access values using the JSON output (useful for custom input names):

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
    - uses: srz-zumix/provide-default-inputs-action@v0
      id: inputs-test
      with:
        name: test
    - uses: srz-zumix/provide-default-inputs-action@v0
      id: inputs-all
    - name: DoSomething
      env:
        INPUTS_TEST: ${{ inputs.test || steps.inputs-test.outputs.value }}
        INPUTS_FLAG: ${{ inputs.flag || fromJson(steps.inputs-all.outputs.value).flag }}
        INPUTS_TEXT: ${{ inputs.text || fromJson(steps.inputs-all.outputs.value).text }}
```

## Feature

### Check Diff

Outputs the difference between workflow_dispatch and workflow_call inputs as a summary.

![check-diff example](https://github.com/srz-zumix/provide-default-inputs-action/assets/1439172/eb7af48c-24e9-42e0-8ef2-49a91ea9b240)
