import { ipcMain } from "electron"
import { z } from "zod"
import { AppError } from "@core/errors"
import type { Channel, IpcContract, IpcResult } from "@shared/ipc"
import { log } from "./logger"

/** Channels that work before the copy is activated. Everything else is refused until a valid license exists. */
const OPEN_CHANNELS = new Set<Channel>(["license:status", "license:activate", "app:info"])
/** Channels that work after activation but before anyone has signed in (the sign-in and first-run screens). */
const PRE_LOGIN_CHANNELS = new Set<Channel>(["auth:status", "auth:setup", "auth:login", "business:get", "restore:scan", "restore:chooseFolder", "restore:start"])
let isLicensed: () => boolean = () => false
let isSignedIn: () => boolean = () => false
export function setLicenseGuard(fn: () => boolean): void {
  isLicensed = fn
}
export function setSessionGuard(fn: () => boolean): void {
  isSignedIn = fn
}

type Handler<C extends Channel> = (payload: IpcContract[C]["req"]) => Promise<IpcContract[C]["res"]> | IpcContract[C]["res"]

/**
 * Every renderer call is validated and every error is turned into a typed result,
 * so the UI never receives a raw stack trace and never talks to the database directly.
 */
export function handle<C extends Channel>(channel: C, schema: z.ZodType | null, fn: Handler<C>): void {
  ipcMain.handle(channel, async (_event, raw): Promise<IpcResult<IpcContract[C]["res"]>> => {
    try {
      if (!OPEN_CHANNELS.has(channel) && !isLicensed()) {
        return { ok: false, error: { code: "LICENSE", message: "This copy of the software is not activated." } }
      }
      if (!OPEN_CHANNELS.has(channel) && !PRE_LOGIN_CHANNELS.has(channel) && !isSignedIn()) {
        return { ok: false, error: { code: "AUTH", message: "Please sign in to continue." } }
      }
      const payload = schema ? schema.parse(raw) : undefined
      return { ok: true, data: await fn(payload as IpcContract[C]["req"]) }
    } catch (err) {
      if (err instanceof AppError) return { ok: false, error: { code: err.code, message: err.message } }
      if (err instanceof z.ZodError) return { ok: false, error: { code: "VALIDATION", message: err.issues.map((i) => i.message).join("; ") } }
      log("error", `IPC ${channel} failed`, err)
      return { ok: false, error: { code: "INTERNAL", message: "Something went wrong. The details were saved to the log." } }
    }
  })
}
