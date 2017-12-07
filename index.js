const fs = require('fs-extra')
const semver = require('semver')
const path = require('path')
const debug = require('debug')('dedupe')

process.on('unhandledRejection', error => {
  throw error
})

const resolveDependencies = (manifest, directory, existingDependencies, doomedDependencies, includeDevDependencies) => {
  const projectDependencies = manifest.dependencies || {}

  if (includeDevDependencies) {
    const devDependencies = manifest.devDependencies || {}

    Object.keys(devDependencies).forEach(key => {
      if (projectDependencies[key]) {
        console.warn(`Dependency ${key} was found in dependencies (${projectDependencies[key]}) and devDepenencies (${devDependencies[key]}) of project '${manifest.name}'.  Using ${projectDependencies[key]}.`)
      } else {
        projectDependencies[key] = devDependencies[key]
      }
    })
  }

  return Promise.all(
    Object.keys(projectDependencies).map(dependency => {
      const depPath = path.join(directory, 'node_modules', path.join.apply(path, dependency.split('/')))

      return fs.exists(depPath)
        .then(exists => {
          if (!exists) {
            return debug(`Project '${manifest.name}' dependency ${dependency} not found on disk`)
          }

          const dependencyManifest = require(path.join(depPath, 'package.json'))
          let resolvedDependency = false

          if (existingDependencies[dependency]) {
            resolvedDependency = existingDependencies[dependency].some(existingDependency => {
              if (semver.satisfies(existingDependency.version, existingDependency.version)) {
                debug(`Project '${manifest.name}' dependency ${dependency} using ${existingDependency.path}`)

                return existingDependency.path
              }
            })
          }

          if (resolvedDependency) {
            if (resolvedDependency !== depPath) {
              doomedDependencies.push(depPath)
              debug(`Will remove duplicate dependency '${dependency}' version '${dependencyManifest.version} path: ${depPath}`)
            }
          } else {
            existingDependencies[dependency] = existingDependencies[dependency] || []

            debug(`Found new dependency '${dependency}' version '${dependencyManifest.version} path: ${depPath}`)

            existingDependencies[dependency].push({
              version: dependencyManifest.version,
              path: depPath
            })
          }

          return resolveDependencies(dependencyManifest, depPath, existingDependencies, doomedDependencies, includeDevDependencies)
        })
    })
  )
}

const dedupe = (args) => {
  const dependencies = {} // deduped dependencies
  const doomedDependencies = [] // a list of paths to remove

  let directory = args.path

  if (!path.isAbsolute(directory)) {
    directory = path.resolve(path.join(process.cwd(), directory))
  }

  debug(`Deduping ${directory}`)

  const manifest = require(path.join(directory, 'package.json'))

  return resolveDependencies(manifest, directory, dependencies, doomedDependencies, args.includeDevDependencies)
    .then(() => {
      debug(`Project '${manifest.name}' dependencies:`)
      debug(JSON.stringify(dependencies, null, 2))
      debug(`Deleting:`)
      debug(JSON.stringify(doomedDependencies, null, 2))

      return Promise.all(
        doomedDependencies.map(doomedDependency => {
          console.info(`Removing duplicate dependency ${doomedDependency}`)
          return fs.remove(doomedDependency)
        })
      )
    })
}

module.exports = dedupe
