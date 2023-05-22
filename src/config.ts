import fs from 'node:fs'
import path from 'node:path'
import { build } from 'tsup'
import type { Privileges } from 'electron'

const outDir = 'node_modules/.@zjinh/electron-builder-encryptor'

export async function buildConfig() {
  if (!fs.existsSync(outDir)) {
    fs.promises.mkdir(outDir)
  }

  const configPath = findConfig(['encryptor.config.ts', 'encryptor.config.js'])

  const outConfigPath = path.resolve(outDir, 'encryptor.config.js')

  // 先打包config
  if (configPath) {
    await build({
      entry: [configPath],
      outDir,
      platform: 'node',
      sourcemap: false,
      dts: false,
      minify: false,
      skipNodeModulesBundle: false,
      silent: true,
      external: [/^[^./]|^\.[^./]|^\.\.[^/]/],
      noExternal: ['@zjinh/electron-builder-encryptor'],
      bundle: true,
      treeshake: true,
      config: false,
    })
    let code = await fs.promises.readFile(outConfigPath, 'utf-8')
    code = treeshakeCode(code)
    await fs.promises.writeFile(outConfigPath, code, 'utf-8')
  } else {
    await fs.promises.writeFile(
      outConfigPath,
      '"use strict";module.exports = {};',
      'utf-8'
    )
  }
}

export async function mergeConfig(mainJsPath: string) {
  const preConfigCode = `"use strict";var __encryptorConfig = require('./encryptor.config.js');__encryptorConfig = __encryptorConfig.default || __encryptorConfig;`

  // 注入到main.js
  await fs.promises.writeFile(
    mainJsPath,
    `${preConfigCode}\n${await fs.promises.readFile(mainJsPath, 'utf-8')}`,
    'utf-8'
  )

  const mainJsDir = path.dirname(mainJsPath)

  await fs.promises.copyFile(
    path.join(outDir, 'encryptor.config.js'),
    path.join(mainJsDir, 'encryptor.config.js')
  )
}

function findConfig(dirs: string[]) {
  for (const dir of dirs) {
    if (fs.existsSync(dir)) {
      return dir
    }
  }
  return null
}

export function treeshakeCode(code: string) {
  const newLocal = /\n(__toESM\()?require\(["'].+["']\)(, 1\))?;/gm
  return code.replace(newLocal, '')
}

export declare type UserConfigExport = UserConfig

export declare interface UserConfig {
  key?: string//加密的字符串
  protocol?: string//渲染进程协议名称
  privileges?: Privileges//electron 自定义协议的配置
  noRegisterSchemes?: boolean//不需要注册自定义协议
  preload?: string | string[]//需要处理的预加载脚本
  renderer?: {
    input: string[],
    output: string,//加密资源后输出的路径名称
  }
  verifyAsar?: boolean//启动时是否验证asar文件完整性
}

export function defineConfig(arg: UserConfigExport) {
  return arg
}
