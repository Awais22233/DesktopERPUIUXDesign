import type { Channel, IpcContract } from "@shared/ipc"

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/** Calls the engine. Resolves with the data or throws an ApiError carrying a plain-language message. */
export async function api<C extends Channel>(channel: C, payload?: IpcContract[C]["req"]): Promise<IpcContract[C]["res"]> {
  if (!window.api) throw new ApiError("NO_ENGINE", "This screen needs the desktop application.")
  const r = await window.api.invoke(channel, payload)
  if (!r.ok) {
    // The session or license ended while the app was open: go back to the sign-in / activation screen.
    if (r.error.code === "AUTH" || r.error.code === "LICENSE") window.dispatchEvent(new CustomEvent("erp:auth-lost"))
    throw new ApiError(r.error.code, r.error.message)
  }
  return r.data
}
