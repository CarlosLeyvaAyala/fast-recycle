import { FormLib, Hotkeys } from "DMLib"
import * as JArray from "JContainers/JArray"
import * as JFormMap from "JContainers/JFormMap"
import * as JMap from "JContainers/JMap"
import * as JTs from "JContainers/JTs"
import * as JValue from "JContainers/JValue"
import { GetHotkey, LA } from "shared"
import {
  Ammo,
  Armor,
  Container,
  Debug,
  Form,
  Game,
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
  interface FileData {
    /** Handle to a JArray */
    ignoreKeyword: number
    /** Handle to a JFormMap */
    breakdownWeapInfo: number
    /** Handle to a JFormMap */
    breakdownArmorInfo: number
    /** Handle to a JFormMap */
    recycleInfo: number
  }

  interface ResultData {
    /** Handle to a JArray */
    itemQueue: number
    /** Handle to a JFormMap */
    resultVal: number
  }

  const enum Pools {
    breakdownArmor = "arrayBreakdownArmorInfo",
    breakdownWeapon = "arrayBreakdownWeapInfo",
    ignoreKeyword = "arrayIgnoreKeyword",
    recycleInfo = "arrayRecycleInfo",
    itemQueue = "arrayItemQueList",
    resultVal = "arrayResultVal",
  }

  const basePath = "Data/RecycleBins"
  const modsPath = `${basePath}/Mods`

  const NotifyNotValid = () =>
    Debug.notification("Can not recycle on this. Select another container.")
  const NotifyEmpty = () =>
    Debug.messageBox("This container is empty. Nothing to recycle.")

  export function Execute() {
    const cn = Game.getCurrentCrosshairRef()
    if (!cn || !Container.from(cn.getBaseObject())) return NotifyNotValid()
    if (cn.getNumItems() === 0) return NotifyEmpty()

    LA("Container was found")
    const fileData = ReadDataFiles()
    const r = InitResultData()
    GetNonIgnored(r, fileData, cn)
    GetMaterialIndex(r, fileData)
    CleanPools()
  }

  function GetMaterialIndex(r: ResultData, fileData: FileData) {
    const IsWeapOrAmmo = (item: Form | null) =>
      Weapon.from(item) || Ammo.from(item)

    const ContainsKeyword = (item: Form | null, keyword: Form | null) => {
      if (IsWeapOrAmmo(item))
        return JFormMap.hasKey(fileData.breakdownWeapInfo, keyword)
      else return JFormMap.hasKey(fileData.breakdownArmorInfo, keyword)
    }

    /** What material keyword is meant to transform to */
    const GetResult = (item: Form | null, keyword: Form | null) => {
      const info = IsWeapOrAmmo(item)
        ? fileData.breakdownWeapInfo
        : fileData.breakdownArmorInfo
      return JMap.getForm(info, "result")
    }

    JTs.JArrayL.ForAllItems(r.itemQueue, (i) => {
      const item = JArray.getForm(r.itemQueue, i)
      if (!item) return

      FormLib.ForEachKeywordR(item, (key) => {
        const k = Form.from(key)
        if (!ContainsKeyword(item, k)) return

        const result = GetResult(item, k)
        if (!JFormMap.hasKey(r.resultVal, result)) return
      })
    })
  }

  function GetNonIgnored(
    r: ResultData,
    fileData: FileData,
    cn: ObjectReference
  ) {
    const NotIgnored = (item: Form | null) => {
      if (!item) return false

      FormLib.ForEachKeywordR(item, (k) => {
        const i = JArray.findForm(fileData.ignoreKeyword, Form.from(k))
        if (i >= 0) return false
      })
      return true
    }

    FormLib.ForEachItemR(cn, (item) => {
      if (!(Weapon.from(item) || Armor.from(item) || Ammo.from(item))) return
      if (NotIgnored(item)) JArray.addForm(r.itemQueue, item)
    })
  }

  /** Initializes arrays used to store results */
  function InitResultData(): ResultData {
    const r: ResultData = {
      itemQueue: JArray.object(),
      resultVal: JFormMap.object(),
    }
    JValue.addToPool(r.itemQueue, Pools.itemQueue)
    JValue.addToPool(r.resultVal, Pools.resultVal)
    return r
  }

  function ReadDataFiles() {
    const jsonFile = JValue.readFromFile(`${basePath}/Base.json`)
    const baseData = GetInfoFromFile(jsonFile)
    ExtendLifeTime(baseData)
    ReadModsFiles(baseData)
    JValue.zeroLifetime(jsonFile)

    // Remove duplicates
    baseData.ignoreKeyword = JArray.unique(baseData.ignoreKeyword)
    return baseData
  }

  /** Adds mod info to baseData.  */
  function ReadModsFiles(baseData: FileData) {
    type AddFunc = (to: number, from: number) => void
    const Append = (tempCat: number, baseCat: number, Add: AddFunc) => {
      if (JValue.isExists(tempCat)) Add(baseCat, tempCat)
      JValue.zeroLifetime(tempCat)
    }
    const AddPair = (to: number, from: number) =>
      JFormMap.addPairs(to, from, true)

    const modFiles = JValue.readFromDirectory(`${modsPath}/`, ".json")
    JTs.JMapL.ForAllKeys(modFiles, (modedjs, _) => {
      const curr = JMap.getObj(modFiles, modedjs)
      const tmp = GetInfoFromFile(curr)

      Append(tmp.ignoreKeyword, baseData.ignoreKeyword, JArray.addFromArray)
      Append(tmp.breakdownWeapInfo, baseData.breakdownWeapInfo, AddPair)
      Append(tmp.breakdownArmorInfo, baseData.breakdownArmorInfo, AddPair)
      Append(tmp.recycleInfo, baseData.recycleInfo, AddPair)

      JValue.zeroLifetime(curr)
    })
    JValue.zeroLifetime(modFiles)
  }

  function ExtendLifeTime(d: FileData) {
    JValue.addToPool(d.breakdownArmorInfo, Pools.breakdownArmor)
    JValue.addToPool(d.breakdownWeapInfo, Pools.breakdownWeapon)
    JValue.addToPool(d.ignoreKeyword, Pools.ignoreKeyword)
    JValue.addToPool(d.recycleInfo, Pools.recycleInfo)
  }

  function GetInfoFromFile(file: number): FileData {
    return {
      ignoreKeyword: JMap.getObj(file, "IgnoreKeyword"),
      breakdownWeapInfo: JMap.getObj(file, "KeywordBreakDownWeap"),
      breakdownArmorInfo: JMap.getObj(file, "KeywordBreakDownArmor"),
      recycleInfo: JMap.getObj(file, "RecycleInfo"),
    }
  }

  function CleanPools() {
    JValue.cleanPool(Pools.breakdownArmor)
    JValue.cleanPool(Pools.breakdownWeapon)
    JValue.cleanPool(Pools.ignoreKeyword)
    JValue.cleanPool(Pools.itemQueue)
    JValue.cleanPool(Pools.recycleInfo)
    JValue.cleanPool(Pools.resultVal)
  }
}
