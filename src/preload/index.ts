import { contextBridge, ipcRenderer } from "electron"
import { CHANNELS, type Channel, type IpcContract, type IpcResult } from "../shared/ipc"

const api = {
  invoke<C extends Channel>(channel: C, payload?: IpcContract[C]["req"]): Promise<IpcResult<IpcContract[C]["res"]>> {
    if (!CHANNELS.includes(channel)) return Promise.reject(new Error(`Unknown channel: ${channel}`))
    return ipcRenderer.invoke(channel, payload)
  },
}

contextBridge.exposeInMainWorld("api", api)
export type Api = typeof api
