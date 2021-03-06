import * as AWS from 'aws-sdk'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as github from '@actions/github'
import * as glob from '@actions/glob'
import * as path from 'path'
import * as readline from 'readline'
import * as utils from '@actions/utils'
import {DepGraph} from 'dependency-graph'
import simpleGit, {SimpleGit} from 'simple-git'

interface SpecDef {
  specPath: string
  pkgName: string
  buildDeps: string[]
}

async function getBuildBundles(specs: string[]): Promise<string[]> {
  const result: string[] = []

  const specDefs = await getSpecDefs(specs)

  const graph: DepGraph<SpecDef> = new DepGraph()
  for (const spec of specDefs.values()) {
    graph.addNode(spec.pkgName, spec)
  }
  for (const spec of specDefs.values()) {
    for (const depName of spec.buildDeps) {
      if (specDefs.has(depName)) {
        graph.addDependency(spec.pkgName, depName)
      }
    }
  }

  for (const pkgName of graph.overallOrder(true)) {
    core.debug(`Getting build bundle for package "${pkgName}"`)
    const pkgList: string[] = [graph.getNodeData(pkgName).specPath]

    for (const depName of graph.dependantsOf(pkgName)) {
      core.debug(`Adding "${depName}" to the "${pkgName}" build bundle`)
      pkgList.push(graph.getNodeData(depName).specPath)
    }
    result.push(pkgList.join(','))
  }

  return result
}

async function getBuildCommit(sdb: AWS.SimpleDB, spec: string): Promise<string | undefined> {
  return (await getSDBAttributes(sdb, spec))['commit_sha']
}

async function getBuildDeps(spec: string): Promise<string[]> {
  const result: string[] = []
  const readLine = readline.createInterface({
    input: fs.createReadStream(spec),
    crlfDelay: Infinity
  })

  for await (const line of readLine) {
    const matched = line.split(/^\s*BuildRequires:\s*/, 2)

    if (matched.length < 2) {
      continue
    }

    const deps = matched[1].split(/[ ,]/)
    for (const pkgName of deps) {
      const match = pkgName.match(/^[a-zA-Z][-._+a-zA-Z0-9]+/)
      if (match) {
        result.push(match[0].replace(/-devel$/, ''))
      }
    }
  }

  return result
}

async function getFileCommit(git: SimpleGit, file: string): Promise<string | undefined> {
  const commit = (await git.log({file})).latest

  if (!commit) {
    return
  }

  return commit.hash
}

async function getSpecList(paths: string[], recursive, force: boolean): Promise<string[]> {
  const workingDir = process.env['GITHUB_WORKSPACE'] ? process.env['GITHUB_WORKSPACE'] : process.cwd()
  const result: string[] = []

  for (const searchPath of paths) {
    const globPattern = path.join(searchPath, recursive ? '**/*.spec' : '*.spec')
    const specFiles = await (await glob.create(globPattern, {matchDirectories: false})).glob()

    for (let spec of specFiles) {
      spec = path.relative(workingDir, spec)

      core.debug(`Found RPM spec "${spec}"`)

      if (await isUpToDate(spec, force)) {
        core.info(`Ignoring spec "${spec}" (repo is up to date)`)
        continue
      }

      result.push(spec)
    }
  }

  return result
}

async function getSpecDefs(specs: string[]): Promise<Map<string, SpecDef>> {
  const result: Map<string, SpecDef> = new Map()

  for (const specPath of specs) {
    const pkgName = getPackageName(specPath)
    const buildDeps = await getBuildDeps(specPath)

    result.set(pkgName, {specPath, pkgName, buildDeps})
  }

  return result
}

function getPackageName(spec: string): string {
  return path.dirname(path.dirname(spec))
}

async function getSDBAttributes(sdb: AWS.SimpleDB, spec: string): Promise<Record<string, string>> {
  const itemName = path.join(github.context.repo.owner, github.context.repo.repo, github.context.ref, spec)
  const sdbDomain = core.getInput('sdb-domain')
  core.debug(`Retrieving package data from SimpleDB domain "${sdbDomain}": ${itemName}`)

  return new Promise(resolve => {
    sdb.getAttributes(
      {
        DomainName: sdbDomain,
        ItemName: itemName
      },
      function (err: AWS.AWSError, data: AWS.SimpleDB.GetAttributesResult) {
        if (err) {
          core.setFailed(`Error getting package info: ${err.stack}`)
          process.exit()
        }

        const result: Record<string, string> = {}

        if (data.Attributes) {
          for (const kvp of data.Attributes) {
            result[kvp['Name']] = kvp['Value']
          }
        }

        core.debug(JSON.stringify(result))
        resolve(result)
      }
    )
  })
}

async function isUpToDate(spec: string, force: boolean): Promise<boolean> {
  if (force) {
    core.debug(`Ignoring update status for "${spec}"`)
    return false
  }

  const workingDir = process.env['GITHUB_WORKSPACE'] ? process.env['GITHUB_WORKSPACE'] : process.cwd()
  const git = simpleGit({baseDir: workingDir})
  const simpleDB = new AWS.SimpleDB()

  const fileCommit = await getFileCommit(git, spec)
  if (!fileCommit) {
    core.debug(`Could not determine file commit hash for "${spec}"`)
    return false
  }
  core.debug(`"${spec}" file commit hash: ${fileCommit}`)

  const buildCommit = await getBuildCommit(simpleDB, spec)
  if (!buildCommit) {
    core.debug(`Could not determine build commit for "${spec}"`)
    return false
  }
  core.debug(`"${spec}" build commit hash: ${buildCommit}`)

  return buildCommit === fileCommit
}

async function run(): Promise<void> {
  try {
    const paths = utils.getInputAsArray('paths')
    const recursive = utils.getInputAsBool('recursive')
    const bundle = utils.getInputAsBool('bundle')
    const force = utils.getInputAsBool('force')

    core.startGroup('Find target specs')
    const specs = await getSpecList(paths, recursive, force)
    const specsList = specs.join(',')
    core.info(`Spec list: ${specsList}`)
    core.setOutput('list', specsList)
    core.endGroup()

    if (!bundle) {
      return
    }

    core.startGroup('Define build grouping and order')
    const matrix = {spec: await getBuildBundles(specs)}
    core.info(`Matrix: ${JSON.stringify(matrix, null, 2)}`)
    core.setOutput('matrix', JSON.stringify(matrix))
    core.endGroup()
  } catch (error) {
    core.setFailed(error.message)
  }
}

void run()
