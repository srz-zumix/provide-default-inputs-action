import * as core from '@actions/core'
import * as io from '@actions/io'
import { exec } from '@actions/exec'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as yaml from 'js-yaml'

interface WorkflowInput {
  type?: string
  description?: string
  required?: boolean
  default?: string | number | boolean | null
}

interface WorkflowInputs {
  [key: string]: WorkflowInput
}

interface WorkflowTrigger {
  inputs?: WorkflowInputs
}

interface WorkflowData {
  on?: {
    workflow_dispatch?: WorkflowTrigger
    workflow_call?: WorkflowTrigger
  }
}

interface GitHubEvent {
  inputs?: Record<string, string | number | boolean | null>
}

// Type for JSON data that could contain various primitive values
type JsonValue = string | number | boolean | null | JsonObject | JsonArray
interface JsonObject {
  [key: string]: JsonValue
}
type JsonArray = JsonValue[]

class ProvideDefaultInputs {
  private tempDir: string
  private downloadYamlFile: string
  private downloadJsonDir: string
  private defaultInputsJson: string
  private workflow: string
  private prioritizeEvent: string
  private selectKeyName: string
  private githubToken: string

  constructor() {
    const runnerTemp = process.env.RUNNER_TEMP || './tmp'
    this.tempDir = path.join(runnerTemp, 'provide-default-inputs')
    this.downloadYamlFile = path.join(
      this.tempDir,
      'provide-default-inputs-download.yml'
    )
    this.downloadJsonDir = path.join(
      this.tempDir,
      'provide-default-inputs-download-jsons'
    )
    this.defaultInputsJson = path.join(
      this.tempDir,
      'provide-default-inputs.json'
    )

    this.workflow = process.env.GITHUB_WORKFLOW || ''
    this.prioritizeEvent = core.getInput('prioritize-event') || ''
    this.selectKeyName = core.getInput('name') || ''
    this.githubToken =
      core.getInput('github_token') || process.env.GITHUB_TOKEN || ''
  }

  private async executeCommand(
    command: string,
    args: string[]
  ): Promise<string> {
    let output = ''
    const env: { [key: string]: string } = {}

    // Copy existing environment variables, filtering out undefined values
    Object.entries(process.env).forEach(([key, value]) => {
      if (value !== undefined) {
        env[key] = value
      }
    })

    // Set GitHub token for gh command
    if (command === 'gh' && this.githubToken) {
      env.GITHUB_TOKEN = this.githubToken
    }

    const options = {
      env,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        }
      }
    }

    await exec(command, args, options)
    return output.trim()
  }

  private toDefaultInputsJson(
    inputs: WorkflowInputs
  ): Record<string, string | number | boolean | null> {
    const result: Record<string, string | number | boolean | null> = {}

    for (const [key, value] of Object.entries(inputs)) {
      // Only include inputs that have a 'default' property defined
      // This distinguishes between default: "" (empty string) and no default property
      if (value.hasOwnProperty('default')) {
        result[key] = value.default!
      }
    }

    return result
  }

  private async summaryInputsDiff(): Promise<void> {
    const workflowDispatchFile = path.join(
      this.downloadJsonDir,
      'workflow_dispatch.json'
    )
    const workflowCallFile = path.join(
      this.downloadJsonDir,
      'workflow_call.json'
    )

    if (
      (await this.fileExists(workflowDispatchFile)) &&
      (await this.fileExists(workflowCallFile))
    ) {
      try {
        const workflowDispatchYml = path.join(
          this.downloadJsonDir,
          'workflow_dispatch.yml'
        )
        const workflowCallYml = path.join(
          this.downloadJsonDir,
          'workflow_call.yml'
        )

        // Convert JSON to YAML
        const dispatchJson = JSON.parse(
          await fs.readFile(workflowDispatchFile, 'utf8')
        ) as JsonObject
        const callJson = JSON.parse(
          await fs.readFile(workflowCallFile, 'utf8')
        ) as JsonObject

        await fs.writeFile(workflowDispatchYml, yaml.dump(dispatchJson))
        await fs.writeFile(workflowCallYml, yaml.dump(callJson))

        // Generate diff
        const diffOutput = await this.executeCommand('diff', [
          '-u',
          workflowDispatchYml,
          workflowCallYml
        ])

        const summary = [
          'workflow_dispatch and workflow_call are different',
          '```diff',
          diffOutput,
          '```'
        ].join('\n')

        if (process.env.GITHUB_STEP_SUMMARY) {
          await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
        }
      } catch (error) {
        // diff command returns non-zero when files differ, which is expected
        core.debug(`Diff operation completed with differences: ${error}`)
      }
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async downloadWorkflow(): Promise<void> {
    // Create directories
    await io.mkdirP(this.downloadJsonDir)

    // Build gh workflow view command
    const args = ['workflow', 'view', this.workflow, '--yaml']
    if (process.env.GITHUB_SHA) {
      args.push('--ref', process.env.GITHUB_SHA)
    }
    if (process.env.GITHUB_REPOSITORY) {
      args.push('--repo', process.env.GITHUB_REPOSITORY)
    }

    // Download workflow
    const workflowYaml = await this.executeCommand('gh', args)
    await fs.writeFile(this.downloadYamlFile, workflowYaml)

    // Parse YAML to JSON
    const workflowData = yaml.load(workflowYaml) as WorkflowData
    const downloadJson = path.join(this.downloadJsonDir, 'download.json')
    await fs.writeFile(downloadJson, JSON.stringify(workflowData, null, 2))

    // Process workflow_dispatch
    if (workflowData.on?.workflow_dispatch) {
      const workflowDispatchFile = path.join(
        this.downloadJsonDir,
        'workflow_dispatch.json'
      )
      await fs.writeFile(
        workflowDispatchFile,
        JSON.stringify(workflowData.on.workflow_dispatch, null, 2)
      )

      if (workflowData.on.workflow_dispatch.inputs) {
        const defaults = this.toDefaultInputsJson(
          workflowData.on.workflow_dispatch.inputs
        )
        const defaultsFile = path.join(
          this.downloadJsonDir,
          'workflow_dispatch.defaults.json'
        )
        await fs.writeFile(defaultsFile, JSON.stringify(defaults, null, 2))
      }
    }

    // Process workflow_call
    if (workflowData.on?.workflow_call) {
      const workflowCallFile = path.join(
        this.downloadJsonDir,
        'workflow_call.json'
      )
      await fs.writeFile(
        workflowCallFile,
        JSON.stringify(workflowData.on.workflow_call, null, 2)
      )

      if (workflowData.on.workflow_call.inputs) {
        const defaults = this.toDefaultInputsJson(
          workflowData.on.workflow_call.inputs
        )
        const defaultsFile = path.join(
          this.downloadJsonDir,
          'workflow_call.defaults.json'
        )
        await fs.writeFile(defaultsFile, JSON.stringify(defaults, null, 2))
      }
    }

    // Check diff if requested
    if (core.getInput('check-diff') === 'true') {
      await this.summaryInputsDiff()
    }
  }

  private async determineSelectEvent(): Promise<void> {
    const workflowDispatchDefaults = path.join(
      this.downloadJsonDir,
      'workflow_dispatch.defaults.json'
    )
    const workflowCallDefaults = path.join(
      this.downloadJsonDir,
      'workflow_call.defaults.json'
    )

    if (!this.prioritizeEvent) {
      // Default to workflow_dispatch if available, otherwise workflow_call
      if (await this.fileExists(workflowDispatchDefaults)) {
        this.prioritizeEvent = 'workflow_dispatch'
      } else if (await this.fileExists(workflowCallDefaults)) {
        this.prioritizeEvent = 'workflow_call'
      } else {
        // Default to workflow_dispatch even if no files exist
        this.prioritizeEvent = 'workflow_dispatch'
      }
    }
  }

  private async createDefaultInputsJson(): Promise<void> {
    const workflowDispatchDefaults = path.join(
      this.downloadJsonDir,
      'workflow_dispatch.defaults.json'
    )
    const workflowCallDefaults = path.join(
      this.downloadJsonDir,
      'workflow_call.defaults.json'
    )

    let mergedDefaults: Record<string, JsonValue> = {}

    // Read both default files if they exist
    const dispatchExists = await this.fileExists(workflowDispatchDefaults)
    const callExists = await this.fileExists(workflowCallDefaults)

    let dispatchDefaults: JsonObject = {}
    let callDefaults: JsonObject = {}

    if (dispatchExists) {
      const dispatchContent = await fs.readFile(
        workflowDispatchDefaults,
        'utf8'
      )
      dispatchDefaults = JSON.parse(dispatchContent) as JsonObject
      core.debug(
        `Loaded workflow_dispatch defaults: ${JSON.stringify(dispatchDefaults)}`
      )
    }

    if (callExists) {
      const callContent = await fs.readFile(workflowCallDefaults, 'utf8')
      callDefaults = JSON.parse(callContent) as JsonObject
      core.debug(
        `Loaded workflow_call defaults: ${JSON.stringify(callDefaults)}`
      )
    }

    if (this.prioritizeEvent === 'workflow_call') {
      // workflow_call has priority: start with dispatch, then override with call
      mergedDefaults = { ...dispatchDefaults, ...callDefaults }
    } else {
      // workflow_dispatch has priority: start with call, then override with dispatch
      mergedDefaults = { ...callDefaults, ...dispatchDefaults }
    }

    core.debug(
      `Merged defaults with ${this.prioritizeEvent} priority: ${JSON.stringify(mergedDefaults)}`
    )
    await fs.writeFile(
      this.defaultInputsJson,
      JSON.stringify(mergedDefaults, null, 2)
    )
  }

  private async processGitHubEvent(): Promise<void> {
    const githubEventPath = process.env.GITHUB_EVENT_PATH
    const inputsJsonFile = path.join(this.downloadJsonDir, 'inputs.json')

    if (githubEventPath && !(await this.fileExists(inputsJsonFile))) {
      try {
        const eventContent = await fs.readFile(githubEventPath, 'utf8')
        const eventData = JSON.parse(eventContent) as GitHubEvent

        if (eventData.inputs) {
          await fs.writeFile(
            inputsJsonFile,
            JSON.stringify(eventData.inputs, null, 2)
          )
        }
      } catch (error) {
        core.debug(`Error processing GitHub event: ${error}`)
      }
    }
  }

  private async generateOutput(): Promise<void> {
    try {
      const inputsJsonFile = path.join(this.downloadJsonDir, 'inputs.json')
      const inputsJson = (await this.fileExists(inputsJsonFile))
        ? inputsJsonFile
        : this.defaultInputsJson

      core.debug(`Using inputs file: ${inputsJson}`)

      // Read the default inputs data
      const defaultInputsContent = await fs.readFile(
        this.defaultInputsJson,
        'utf8'
      )
      const defaultInputsData = JSON.parse(defaultInputsContent) as JsonObject
      core.debug(`Default inputs: ${JSON.stringify(defaultInputsData)}`)

      // Read the actual inputs data
      const inputsContent = await fs.readFile(inputsJson, 'utf8')
      const inputsData = JSON.parse(inputsContent) as JsonObject
      core.debug(`Inputs data: ${JSON.stringify(inputsData)}`)

      let outputValue: string
      if (!this.selectKeyName) {
        // Return the entire inputs JSON as compact JSON string
        outputValue = JSON.stringify(inputsData)
      } else {
        // Return the specific key value from inputs JSON
        const value = inputsData[this.selectKeyName]
        if (value === undefined || value === null) {
          outputValue = ''
        } else if (typeof value === 'object') {
          // If it's an object or array, stringify it
          outputValue = JSON.stringify(value)
        } else {
          // Primitive values
          outputValue = String(value)
        }
      }

      core.debug(`Output value: ${outputValue}`)

      // Set outputs
      core.setOutput('json', this.defaultInputsJson)
      core.setOutput('value', outputValue)

      // Set individual key-value pairs as outputs
      for (const [key, value] of Object.entries(inputsData)) {
        let stringValue: string
        if (value === undefined || value === null) {
          stringValue = ''
        } else if (typeof value === 'object') {
          stringValue = JSON.stringify(value)
        } else {
          stringValue = String(value)
        }
        core.setOutput(key, stringValue)
        core.debug(`Set output ${key}: ${stringValue}`)
      }
    } catch (error) {
      core.error(`Error in generateOutput: ${error}`)
      throw error
    }
  }

  async run(): Promise<void> {
    try {
      // Download and process workflow if not already done
      if (!(await this.fileExists(this.downloadYamlFile))) {
        await this.downloadWorkflow()
      }

      // Determine which event to use
      await this.determineSelectEvent()

      // Create default inputs JSON
      await this.createDefaultInputsJson()

      // Process GitHub event if available
      await this.processGitHubEvent()

      // Generate final output
      await this.generateOutput()
    } catch (error) {
      core.setFailed(`Action failed with error: ${error}`)
    }
  }
}

// Run the action
const action = new ProvideDefaultInputs()
action.run()

export { ProvideDefaultInputs }
