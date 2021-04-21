import * as core from '@actions/core'
import * as glob from '@actions/glob'
import * as path from 'path'
import * as utils from '@actions/utils'

interface JobInclude {
  'build-root': string
  'package-name': string
  spec: string
}

interface JobMatrix {
  include: JobInclude[]
}

async function getIncludes(paths: string[], recursive: boolean): Promise<JobInclude[]> {
  const returnVal: JobInclude[] = []

  for (const searchPath of paths) {
    const globPattern = path.join(searchPath, recursive ? '**/*.spec' : '*.spec')
    const specFiles = await (await glob.create(globPattern)).glob()

    for (let spec of specFiles) {
      if (!utils.fileExist(spec)) {
        core.warning(`Ignoring path "${spec}" (not a file)`)
        continue
      }

      spec = path.relative(process.env['GITHUB_WORKSPACE'] ? process.env['GITHUB_WORKSPACE'] : process.cwd(), spec)

      core.debug(`Found RPM spec "${spec}"`)

      returnVal.push({
        'build-root': path.dirname(path.dirname(spec)),
        'package-name': path.basename(spec, '.spec'),
        spec
      })
    }
  }
  return returnVal
}

async function run(): Promise<void> {
  try {
    const paths = utils.getInputAsArray('paths')
    const recursive = utils.getInputAsBool('recursive')

    core.startGroup('Find targets')
    const jobMatrix: JobMatrix = {include: await getIncludes(paths, recursive)}
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
