import fs from 'fs'
import path from 'path'
import mime from 'mime'
import { app, protocol } from 'electron'
import { getAppResourcesMap } from './decrypt'
import { readAppAsarMd5Sync } from './encrypt'
import { mergeDefaultConfig } from './default-config'

const platform = process.platform
let execDir = path.dirname(process.execPath)

if (platform === 'darwin') {
  execDir = path.join(execDir, '..')
}

__encryptorConfig = mergeDefaultConfig(__encryptorConfig)

if (__encryptorConfig.verifyAsar) {
  verifyModifySync()
}

const privileges = __encryptorConfig.privileges

const appProtocol = __encryptorConfig.protocol

if (!__encryptorConfig.noRegisterSchemes){
  protocol.registerSchemesAsPrivileged([{ scheme: appProtocol, privileges }])
}

app.whenReady().then(() => {
  let rendererPath = ''
  let appResourcesMap=new Map()
  rendererPath = path.join(execDir, __encryptorConfig.renderer.output)
  try {
    appResourcesMap = getAppResourcesMap(fs.readFileSync(rendererPath), __encryptorConfig.key)
  }catch (e){
    console.error(`read ${rendererPath} failed`)
    console.error(e)
  }
  protocol.registerBufferProtocol(appProtocol, (request, callback) => {
    try {
      let head=`${appProtocol}://apps/`
      let url = request.url.replace(head, '')
      url = url.split(/#|\?/)[0]
      url=url.replace(appProtocol+'://./','')
      callback({
        data: appResourcesMap.get(url),
        mimeType: mime.getType(url) || undefined,
      })
    } catch (error) {
      console.error(error)
      callback({ data: undefined })
    }
  })
})

function verifyModifySync() {
  const appAsarDir = path.join(execDir, 'resources', 'app.asar')
  console.time('verifyFile')
  const jsonStr = fs.readFileSync(path.join(execDir, 'resources/app.json'), 'utf-8')
  let verifyMd5 = ''
  try {
    verifyMd5 = JSON.parse(jsonStr).md5
  }catch (e) {
    console.log('get md5 file ERR! '+e)
  }
  const asarMd5 = readAppAsarMd5Sync(appAsarDir, __encryptorConfig.key)
  console.timeEnd('verifyFile')
  if (verifyMd5 !== asarMd5) {
    console.log('verify resource file ERR!')
    process.exit(9999)
  }
}
