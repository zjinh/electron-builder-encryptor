# electron-builder-encryptor

electron 打包加密工具

## 特性

- 只在使用 `electron-builder` 打包时生效，不影响开发调试
- 使用 [bytenode](https://github.com/bytenode/bytenode) 加密主进程，自定义方法加密渲染进程
- 防篡改 app.asar 文件

## 使用

```bash
npm i @zjinh/electron-builder-encryptor -D
# 这3个库需要添加到项目中,不添加每次打包时将默认安装至打包后目录
npm i adm-zip bytenode mime
```

## 在 `electron-builder` 配置中添加 `afterPack`钩子

```json5
{
    "build": {
        "asar": true,
        "afterPack": "node_modules/@zjinh/electron-builder-encryptor",
    }
}
```

## 主进程中

```js
if (!app.isPackaged) {
    // 打包前的地址
    mainWindow.loadFile('renderer/index.html')
} else {
    // 打包后访问的地址
    mainWindow.loadURL(`${__encryptorConfig.protocol}://./index.html`)
}
```

## 配置

```ts
// encryptor.config.ts 或者 encryptor.config.js
import { defineConfig } from '@zjinh/electron-builder-encryptor'

export default defineConfig({
    /**
     * 加密的密钥
     */
    key: 'zjinh.',//加密的key
    renderer: {
      input: [],//渲染进程的文件/文件夹
      output: './resources/render.pkg',
    },
})
```

## 所有配置

```ts
interface UserConfig {
  key?: string//加密的字符串，默认abc.123.bca.456
  protocol?: string//渲染进程协议名称，默认app
  privileges?: Privileges//electron 自定义协议的配置
  noRegisterSchemes?: boolean//不需要注册自定义协议
  preload?: string | string[]//需要处理的预加载脚本，默认preload.js
  renderer?: {
    input: string[],//默认[]，可定义多个文件夹/文件
    output: string,//加密资源后输出的路径名称
  }
  verifyAsar?: boolean//启动时是否验证asar文件完整性，默认false
}
```
