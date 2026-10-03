import type { Channel, IpcContract, IpcResult } from "../shared/ipc"

declare global {
  interface Window {
    api?: {
      invoke<C extends Channel>(channel: C, payload?: IpcContract[C]["req"]): Promise<IpcResult<IpcContract[C]["res"]>>
    }
  }
}
export {}
