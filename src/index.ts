import fs from 'fs'
import path from 'path'
import asar from 'asar'
import AdmZip from 'adm-zip'
import { log } from 'builder-util'
import { compileToBytenode, encAes, readAppAsarMd5 } from './encrypt'
import { buildConfig, mergeConfig } from './config'
import { mergeDefaultConfig } from './default-config'
import { buildBundle } from './build'
import type { AfterPackContext } from 'electron-builder'
import { execSync } from 'child_process'

export default function (context: AfterPackContext) {
  return run(context)
}

export interface BeforeRePackAsarContext {
  tempAppDir: string
}

export interface RunOptions {
  beforeRePackAsar?: (context: BeforeRePackAsarContext) => Promise<void>
}

//在打包成exe之前做点什么
export async function run(context: AfterPackContext, options: RunOptions = {}) {
  const time = Date.now()
  const sep=path.sep
  await buildConfig()
  const encryptorConfig = getConfig()
  const project=context.packager.projectDir
  const packageInfo=require(project+'/package.json')
  let appOutDir = context.appOutDir
  if (context.packager.platform.name === 'mac') {
    appOutDir = path.join(
      appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents'
    )
  }

  const tempAppDir = path.join(appOutDir, '../', 'app')
  const resourcesDir = path.join(appOutDir, 'resources')
  const appAsarPath = path.join(resourcesDir, 'app.asar')

  // 先解压到缓存目录
  asar.extractAll(appAsarPath, tempAppDir)

  await syncCopyModules(project,tempAppDir).then((rs)=>{
    return rs
  }).catch((e)=>{
    log.error(`encrypt failed! reason:${e}`)
    process.exit(1)
  })

  const packageJson = JSON.parse(
    await fs.promises.readFile(path.join(tempAppDir, 'package.json'), 'utf8')
  )
  const exeName=context.packager.config.productName||packageJson.name
  const mainJsPath = path.join(tempAppDir, packageJson.main)
  const mainDir = path.dirname(mainJsPath)

  // 将入口改为编译器
  fs.renameSync(mainJsPath, `${mainJsPath}.tmp`)
  await fs.promises.writeFile(mainJsPath, 'require(process.argv[1])', 'utf-8')
  await asar.createPackage(tempAppDir, appAsarPath)
  fs.renameSync(`${mainJsPath}.tmp`, mainJsPath)

  const renderFolder='render'
  //获取静态资源目录
  try {
    await fs.promises.rm(tempAppDir+sep+renderFolder, { recursive: true })
  }catch (e) {

  }
  fs.mkdirSync(tempAppDir+sep+renderFolder)
  let rendererDirPaths:string[]=encryptorConfig.renderer.input
  rendererDirPaths.forEach((dir)=>{
    fs.renameSync(path.join(tempAppDir, dir),`${tempAppDir}${sep}${renderFolder}${sep}${dir}`)
  })

  // 可执行文件
  let execPath = path.join(appOutDir, exeName)
  if (context.packager.platform.name === 'windows') {
    execPath = `${execPath}.exe`
  }

  const mainJsCPath = path.join(mainDir, 'main-c.jsc')

  // 往main.js添加preload.js
  await fs.promises.writeFile(
    mainJsPath,
    `${await fs.promises.readFile(
      path.join(__dirname, 'preload.js'),
      'utf-8'
    )}\n${await fs.promises.readFile(mainJsPath, 'utf-8')}`,
    'utf-8'
  )

  await mergeConfig(mainJsPath)

  const cwd = process.cwd()
  const shuldCleanFiles = new Set<string>()
  const mainBundlePath = await buildBundle(path.relative(cwd, mainJsPath), shuldCleanFiles)

  // 将main.js加密
  await compileToBytenode(path.join(cwd, mainBundlePath), mainJsCPath, execPath)
  // 修改入口文件
  await fs.promises.writeFile(
    mainJsPath,
    `"use strict";require('bytenode');require('v8').setFlagsFromString('--no-lazy');require('./main-c.jsc');`,
    'utf-8'
  )

  // 将renderer preload.js加密
  const preloadJsPaths = typeof encryptorConfig.preload === 'string'?[encryptorConfig.preload]:encryptorConfig.preload

  for (const _preloadJsPath of preloadJsPaths) {
    const preloadJsName = path.basename(_preloadJsPath, '.js')
    const rendererPreloadJsPath = path.join(mainDir, _preloadJsPath)
    const preloadJsDir = path.dirname(rendererPreloadJsPath)
    if (fs.existsSync(rendererPreloadJsPath)) {
      const rendererPreloadJsCPath = path.join(
        preloadJsDir,
        `${preloadJsName}-c.jsc`
      )
      const preloadBundlePath = await buildBundle(
        path.relative(cwd, rendererPreloadJsPath),
        shuldCleanFiles
      )

      await compileToBytenode(
        path.join(cwd, preloadBundlePath),
        rendererPreloadJsCPath,
        execPath
      )
      await fs.promises.writeFile(
        rendererPreloadJsPath,
        `"use strict";require('bytenode');require('v8').setFlagsFromString('--no-lazy');require('./${preloadJsName}-c.jsc');`,
        'utf-8'
      )
    }
  }

  // 清理
  for (const item of shuldCleanFiles) {
    await fs.promises.rm(item, { recursive: true })
  }
  // 删除空目录
  let reflectivePath='./'+renderFolder
  cleanEmptyDir(tempAppDir, [reflectivePath, 'node_modules'])

  const rendererDir = path.join(mainDir, reflectivePath)
  const entryBaseName = path.basename(reflectivePath)
  const rendererTempPath = path.join(mainDir, `${entryBaseName}.pkg`)

  // 加密渲染进程
  await buildMainApp(rendererDir, rendererTempPath, encryptorConfig.key)

  if (encryptorConfig.renderer.output) {
    const rendererOutPath = path.join(appOutDir, encryptorConfig.renderer.output)
    const rendererOutDir = path.dirname(rendererOutPath)
    if (!fs.existsSync(rendererOutDir)) {
      await fs.promises.mkdir(rendererOutDir, { recursive: true })
    }
    await fs.promises.rename(rendererTempPath, rendererOutPath)
  }

  await fs.promises.rm(rendererDir, { recursive: true })

  if (options.beforeRePackAsar) {
    await options.beforeRePackAsar({ tempAppDir })
  }

  // 搞回去
  await asar.createPackage(tempAppDir, appAsarPath)
  await writeLicense(
    appAsarPath,
    packageInfo,
    path.join(resourcesDir, 'app.json'),
    encryptorConfig.key
  )
  await fs.promises.rm(tempAppDir, { recursive: true })

  log.info(`encrypt ${packageInfo.name} success takes ${(Date.now() - time)/1000}s.`)
}

//删除目录下的所有空文件夹
function cleanEmptyDir(dir: string, excludes?: string[]) {
  let files = fs.readdirSync(dir)
  if (excludes) {
    files = files.filter(item => !excludes.includes(item))
  }
  if (files.length > 0) {
    files.forEach(file => {
      const fullPath = path.join(dir, file)
      if (fs.statSync(fullPath).isDirectory()) {
        cleanEmptyDir(fullPath)
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath)
        }
      }
    })
  }
}

function syncCopyModules(project:string, tempAppDir:string){
  let versionList:any={
    'adm-zip':'0.5.10',
    bytenode:'1.4.1',
    mime:'3.0.0',
  }
  let dependencies=Object.keys(versionList)
  log.info(`checking ${dependencies.join(',')} dependencies`)
  let copyList:Promise<any>[]=[]
  let sep=path.sep
  dependencies.forEach((name)=>{
    let srcDir=project+sep+'node_modules'+sep+name
    let target=tempAppDir+sep+'node_modules'+sep+name
    copyList.push(copyModule(srcDir,target))
  })
  function copyModule(srcDir:string,tarDir:string){
    return new Promise((resolve, reject)=>{
      let fsExtract = require("fs-extra");
      if(!fsExtract.existsSync(srcDir)){
        let baseName=path.basename(srcDir) as string
        let version=versionList[baseName]
        log.info(`start install ${baseName}@${version}`)
        try {
          execSync(`cd ${tempAppDir} && npm i ${baseName}@${version}`,{
            stdio:'ignore'
          })
          log.info(`install ${baseName}@${version} success`)
          resolve(true)
        }catch (e) {
          log.error(`install ${baseName}@${version} fail reason: ${e}`)
          reject(e)
        }
      }else{
        fsExtract.copy(srcDir,tarDir, function (err:any) {
          if (err){
            reject(err)
          }else{
            resolve(true)
          }
        })
      }
    })
  }
  return Promise.all(copyList)
}

async function writeLicense(fileDir: string, appPackage:any, output: string, key: string) {
  const asarMd5 = await readAppAsarMd5(fileDir, key)
  let fileData = {
    name: appPackage.name,
    version: appPackage.version,
    md5: asarMd5,
  }
  await fs.promises.writeFile(output, JSON.stringify(fileData,null,4), 'utf-8')
}

//将app加密打包并藏起来
async function buildMainApp(input: string, output: string, key: string) {
  const zip = new AdmZip()
  zip.addLocalFolder(input)
  let buf = zip.toBuffer()
  buf = encAes(buf, key)
  await fs.promises.writeFile(output, buf)
}

export function getConfig() {
  let encryptorConfig = require(path.resolve(
    process.cwd(),
    'node_modules/.@zjinh/electron-builder-encryptor/encryptor.config.js'
  ))
  encryptorConfig = encryptorConfig.default || encryptorConfig
  return mergeDefaultConfig(encryptorConfig)
}

export { defineConfig } from './config'
