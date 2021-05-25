import * as AWS from 'aws-sdk'
import * as core from '@actions/core'
import * as github from '@actions/github'
import * as glob from '@actions/glob'
import * as path from 'path'
import * as utils from '@actions/utils'
import simpleGit, {SimpleGit} from 'simple-git'

interface JobInclude {
  spec: string
}

interface JobMatrix {
  include: JobInclude[]
}

async function getBuildCommit(sdb: AWS.SimpleDB, spec: string): Promise<string | undefined> {
  return (await getSDBAttributes(sdb, spec))['commit_sha']
}

async function getFileCommit(git: SimpleGit, file: string): Promise<string | undefined> {
  const commit = (await git.log({file})).latest

  if (!commit) {
    throw new Error('Failed to retrieve spec latest commit')
  }

  return commit.hash
}

async function getIncludes(paths: string[], recursive, force: boolean): Promise<JobInclude[]> {
  const workingDir = process.env['GITHUB_WORKSPACE'] ? process.env['GITHUB_WORKSPACE'] : process.cwd()
  const git = simpleGit({baseDir: workingDir})
  const returnVal: JobInclude[] = []
  const simpleDB = new AWS.SimpleDB()

  for (const searchPath of paths) {
    const globPattern = path.join(searchPath, recursive ? '**/*.spec' : '*.spec')
    const specFiles = await (await glob.create(globPattern)).glob()

    for (let spec of specFiles) {
      if (!utils.fileExist(spec)) {
        core.warning(`Ignoring path "${spec}" (not a file)`)
        continue
      }

      spec = path.relative(workingDir, spec)

      core.debug(`Found RPM spec "${spec}"`)

      if (!force) {
        const fileCommit = await getFileCommit(git, spec)
        const buildCommit = await getBuildCommit(simpleDB, spec)

        if (buildCommit && buildCommit !== fileCommit) {
          core.warning(`Ignoring spec "${spec}" (repo is up to date)`)
          continue
        }
      }

      returnVal.push({spec})
    }
  }

  return returnVal
}

async function getSDBAttributes(sdb: AWS.SimpleDB, spec: string): Promise<Record<string, string>> {
  const itemName = path.join(github.context.repo.owner, github.context.repo.repo, github.context.ref, spec)
  const sdbDomain = utils.getInputAsString('sdb-domain')
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

async function run(): Promise<void> {
  try {
    const paths = utils.getInputAsArray('paths')
    const recursive = utils.getInputAsBool('recursive')
    const force = utils.getInputAsBool('force')

    core.startGroup('Find targets')
    const jobMatrix: JobMatrix = {include: await getIncludes(paths, recursive, force)}
    core.endGroup()

    core.startGroup('Set output')
    core.setOutput('matrix', JSON.stringify(jobMatrix))
    core.info(JSON.stringify(jobMatrix, null, 2))
    core.endGroup()
  } catch (error) {
    core.setFailed(error.message)
  }
}

void run()
