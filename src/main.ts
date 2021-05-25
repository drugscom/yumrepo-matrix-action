import * as AWS from 'aws-sdk'
import * as core from '@actions/core'
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

async function getIncludes(paths: string[], recursive, force: boolean): Promise<JobInclude[]> {
  const workingDir = process.env['GITHUB_WORKSPACE'] ? process.env['GITHUB_WORKSPACE'] : process.cwd()
  const git = simpleGit({baseDir: workingDir})
  const returnVal: JobInclude[] = []

  AWS.config.getCredentials(function (err) {
    if (err) {
      core.setFailed(`Error getting AWS credentials: ${err.stack}`)
      process.exit()
    }
  })

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
        const specUpdated = await getLastUpdate(git, spec)
        const specBuilt = await getLastBuild(simpleDB, spec)

        if (specBuilt && specBuilt >= specUpdated) {
          core.warning(`Ignoring spec "${spec}" (repo is up to date)`)
          continue
        }
      }

      returnVal.push({spec})
    }
  }

  return returnVal
}

async function getLastBuild(sdb: AWS.SimpleDB, spec: string): Promise<Date | undefined> {
  const attrs = await getSDBAttributes(sdb, spec)

  const timestamp = parseInt(attrs['timestamp'], 10)

  if (isNaN(timestamp)) {
    return
  }

  return new Date(timestamp)
}

async function getLastUpdate(git: SimpleGit, file: string): Promise<Date> {
  const commit = (await git.log({file})).latest
  return commit ? new Date(commit.date) : new Date()
}

async function getSDBAttributes(sdb: AWS.SimpleDB, spec: string): Promise<Record<string, string>> {
  return new Promise(resolve => {
    sdb.getAttributes(
      {
        DomainName: 'packages',
        ItemName: spec,
        AttributeNames: ['timestamp']
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
