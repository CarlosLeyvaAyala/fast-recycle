import { DebugLib as D, Hotkeys as H } from "DMLib"
import { settings } from "skyrimPlatform"

export interface Config {
  loggingLevel: string
  ignoreEnchanted: boolean
  processByItemName: boolean
  hotkeys: Hotkeys
}

export interface Hotkeys {
  recycle: string
}

export const modNameDisplay = "FastRecycle"
const mod_name = "fast-recycle"

const d = D.Log.CreateAll(
  modNameDisplay,
  D.Log.LevelFromSettings(mod_name, "loggingLevel"),
  D.Log.ConsoleFmt,
  D.Log.FileFmt
)

/** Log **ALL** messages. */
export const LA = d.None
export const LAT = d.TapN
/** Log error. */
export const LE = d.Error
/** Log info. */
export const LI = d.Info
/** Log verbose. */
export const LV = d.Verbose
export const LVT = d.TapV

/** Get hotkey from settings */
const GHk = (k: string) => H.FromObject(mod_name, "hotkeys", k)

/** Gets a hotkey and logs it to console. */
export const GetHotkey = H.GetAndLog(LAT, GHk)

export type Materials = { [key: string]: KeywordData[] }

export interface FileData {
  Keywords: Materials
}

export interface KeywordData {
  recycleTo: string
  matRatio: number
}

//@ts-ignore
export const config: Config = settings[mod_name]
