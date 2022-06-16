import { DebugLib, FormLib, Hotkeys } from "DMLib"
import * as MiscUtil from "PapyrusUtil/MiscUtil"
import { FileData, GetHotkey, LA, LE, LV } from "shared"
import {
  Armor,
  Container,
  Debug,
  Form,
  Game,
  Keyword,
  ObjectReference,
  on,
  Weapon,
} from "skyrimPlatform"

export function main() {
  const R = GetHotkey("recycle")
  const RL = Hotkeys.ListenTo(R)

  on("update", () => {
    RL(Recycle.Execute)
  })

  LA("Initialization success")
}

// Transform from
// \s*"__formData\|(.*)": {.*"name".*Material(\w+)".*result.*"__formData\|(.*)".*}

// Transform to
// "$2": [{"recycleTo": "$3", "matRatio": 0.05}],\n

namespace Recycle {
  const basePath = "Data/SKSE/Plugins/FastRecycle"

  const NotifyNotValid = () =>
    Debug.notification("Can not recycle on this. Select another container.")
  const NotifyEmpty = () =>
    Debug.messageBox("This container is empty. Nothing to recycle.")

  const LVs = (v: string) => LV(v)

  /** Unique FormId to form */
  const uIdToFrom = (uId: string) => {
    const s = uId.split("|")
    return Game.getFormFromFile(Number(s[1]), s[0])
  }

  interface ProcessData {
    /** List of FormIDs for the keywords that will be ignored. */
    ignore: number[]
    /** Materials to recycle to. */
    mats: FileData
  }

  /** Counts non playable items in chest to avoid false positives.  */
  function CountNonPlayable(cn: ObjectReference) {
    let n = 0
    FormLib.ForEachItemREx(cn, (i) => {
      if (!i.isPlayable()) n++
    })
    return n
  }

  export function Execute() {
    const cn = Game.getCurrentCrosshairRef()
    if (!cn || !Container.from(cn.getBaseObject())) return NotifyNotValid()
    const n = cn.getNumItems()
    if (n === 0) return NotifyEmpty()
    if (CountNonPlayable(cn) === n) return NotifyEmpty()

    const data = ReadDataFiles()
    Recycle(cn, data)
  }

  const F = FormLib
  const IsValidType = (t: FormLib.ItemType) =>
    t == F.ItemType.Weapon ||
    t == F.ItemType.Ammo ||
    t == F.ItemType.Armor ||
    t == F.ItemType.Misc

  const ShouldBeIgnored = (i: Form, keys: number[]) =>
    keys.filter((id) => i.hasKeyword(Keyword.from(Game.getFormEx(id))))
      .length >= 1

  const IsEnchanted = (i: Form) =>
    Armor.from(i)?.getEnchantment() || Weapon.from(i)?.getEnchantment()

  type RecycleResult = Map<string, number>

  function GetAllKeywordMatches(item: Form, data: ProcessData) {
    const keys = data.mats.Keywords
    let allMatches: string[] = []

    FormLib.ForEachKeywordR(item, (k) => {
      const kName = k.getString()
      for (const key in keys)
        if (kName.toLowerCase().includes(key.toLowerCase()))
          allMatches.push(key)
    })
    return allMatches
  }

  function ItemToMats(
    item: Form,
    n: number,
    data: ProcessData
  ): RecycleResult | null {
    const keys = data.mats.Keywords
    const allMatches = GetAllKeywordMatches(item, data)

    if (allMatches.length < 1) return null
    const lastMatch = allMatches[allMatches.length - 1]

    if (keys[lastMatch].length < 1) return null // Keyword with empty materials

    let r: RecycleResult = new Map()
    const w = item.getWeight() * n

    keys[lastMatch].forEach((m) => {
      r.set(m.recycleTo, w * m.matRatio)
    })
    return r
  }

  function ItemsToMats(cn: ObjectReference, data: ProcessData) {
    let result: RecycleResult = new Map()
    FormLib.ForEachItemREx(cn, (i) => {
      if (!i.isPlayable()) return

      const t = FormLib.GetItemType(i)
      if (!IsValidType(t)) return
      if (ShouldBeIgnored(i, data.ignore)) return
      if (IsEnchanted(i)) return

      const n = cn.getItemCount(i)
      const r = ItemToMats(i, n, data)
      if (!r) {
        LV(`${i.getName()} has no materials to get from recycling.`)
        return
      }

      cn.removeItem(i, n, true, null)

      // Add gotten maps to global materials result
      for (const [k, v] of r) {
        const old = result.has(k) ? result.get(k) : 0
        //@ts-ignore
        result.set(k, old + v)
      }
    })
    for (const [k, v] of result) {
      result.set(k, Math.ceil(v))
    }

    return result
  }

  function Recycle(cn: ObjectReference, data: ProcessData) {
    const recycled = ItemsToMats(cn, data)
    recycled.forEach((v, k) => {
      const item = uIdToFrom(k)
      cn.addItem(item, v, true)
    })
    Debug.messageBox("Recycling has finished")
  }

  /** Gets all data this mod needs to work */
  function ReadDataFiles(): ProcessData {
    return {
      mats: ReadMaterials(),
      ignore: ReadIgnored(),
    }
  }

  /** Logs a title that can be easily seen. */
  function LogTitle(title: string) {
    LV("")
    LV(title)
    LV("*************************")
  }

  /** Reads ignored keywords */
  function ReadIgnored(): number[] {
    const errFmt =
      "Ignored keywords file does not exist. All items will be recycled."
    const p = `${basePath}/ignore.json`
    const e = MiscUtil.FileExists(p)

    const ignore: string[] = e
      ? JSON.parse(MiscUtil.ReadFromFile(p))
      : DebugLib.Log.R(LE(errFmt), [])

    LogTitle("Ignored keywords")
    ignore.forEach(LVs)
    const r = ignore
      .map((v) => uIdToFrom(v)?.getFormID() || 0)
      .filter((v) => v !== 0)

    LV("Ignored keywords by FormID")
    r.forEach((v) => LV(v.toString()))

    return r
  }

  /** Reads material files. Returns a single object with all valid material definitions. */
  function ReadMaterials() {
    const files = MiscUtil.FilesInFolder(basePath, ".json").filter((s) =>
      s.toLowerCase().startsWith("mats_")
    )
    LogTitle("Material files")
    files.forEach(LVs)

    const mats: FileData[] = files.map((fName) =>
      JSON.parse(MiscUtil.ReadFromFile(`${basePath}/${fName}`))
    )
    LogMatFilesData(mats, `Material data (size = ${mats.length})`)

    return ProcessFileMats(mats)
  }

  /** Returns a single object with all material definitions that currently exist in game. */
  function ProcessFileMats(mats: FileData[]) {
    const e = GetExistingMaterialsOnly(mats)

    let r: FileData = e[0]
    e.forEach((d) => {
      for (const k in d.Keywords) r.Keywords[k] = d.Keywords[k]
    })
    LogTitle("Merged material data")
    LogSingleMat(r)
    return r
  }

  /** From all files, removes all material definitions that aren't currently loaded in game. */
  function GetExistingMaterialsOnly(mats: FileData[]) {
    const uIdExists = (uId: string) => uIdToFrom(uId) !== null

    const existent = mats.map((d) => {
      for (const key in d.Keywords) {
        const mat = d.Keywords[key]
        const e = mat.filter((m) => uIdExists(m.recycleTo))
        d.Keywords[key] = e
      }
      return d
    })

    LogMatFilesData(existent, "Existent materials in current game")
    return existent
  }

  /** Logs an array of materials got from many files. */
  function LogMatFilesData(mats: FileData[], title: string) {
    LogTitle(title)
    mats.forEach((v) => {
      LV("==========")
      LogSingleMat(v)
    })
  }

  /** Logs material definitions from a single file. */
  function LogSingleMat(mat: FileData) {
    for (const key in mat.Keywords) {
      LV(`${key}`)
      const mt = mat.Keywords[key]
      mt.forEach((m) =>
        LV(`      Recycle to: ${m.recycleTo} Mat ratio: ${m.matRatio}`)
      )
    }
  }
}
