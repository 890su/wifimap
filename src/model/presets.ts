import type { AccessPoint, ApPreset, ClientDevice, ClientPreset, Radio, WifiGen } from './types'

export interface ApRadioParams {
  wifiGen: WifiGen
  mimo: number
  backhaul: AccessPoint['backhaul']
  band24: Radio
  band5: Radio
}

export const AP_PRESETS: Record<ApPreset, ApRadioParams> = {
  isp: {
    wifiGen: 'wifi5',
    mimo: 2,
    backhaul: 'wired',
    band24: { enabled: true, txPowerDbm: 20, gainDbi: 2, channelWidthMHz: 20 },
    band5: { enabled: true, txPowerDbm: 23, gainDbi: 3, channelWidthMHz: 80 },
  },
  wifi5: {
    wifiGen: 'wifi5',
    mimo: 2,
    backhaul: 'wired',
    band24: { enabled: true, txPowerDbm: 20, gainDbi: 4, channelWidthMHz: 20 },
    band5: { enabled: true, txPowerDbm: 23, gainDbi: 5, channelWidthMHz: 80 },
  },
  wifi6: {
    wifiGen: 'wifi6',
    mimo: 2,
    backhaul: 'wired',
    band24: { enabled: true, txPowerDbm: 20, gainDbi: 4, channelWidthMHz: 20 },
    band5: { enabled: true, txPowerDbm: 23, gainDbi: 5, channelWidthMHz: 80 },
  },
  mesh: {
    wifiGen: 'wifi6',
    mimo: 2,
    backhaul: 'mesh-wireless',
    band24: { enabled: true, txPowerDbm: 18, gainDbi: 3, channelWidthMHz: 20 },
    band5: { enabled: true, txPowerDbm: 20, gainDbi: 4, channelWidthMHz: 80 },
  },
  repeater: {
    wifiGen: 'wifi5',
    mimo: 2,
    backhaul: 'repeater',
    band24: { enabled: true, txPowerDbm: 17, gainDbi: 2, channelWidthMHz: 20 },
    band5: { enabled: true, txPowerDbm: 18, gainDbi: 2, channelWidthMHz: 40 },
  },
}

export const CLIENT_PRESETS: Record<ClientPreset, Pick<ClientDevice, 'wifiGen' | 'mimo' | 'supports5'>> = {
  phone: { wifiGen: 'wifi6', mimo: 2, supports5: true },
  laptop: { wifiGen: 'wifi6', mimo: 2, supports5: true },
  tv: { wifiGen: 'wifi5', mimo: 2, supports5: true },
  console: { wifiGen: 'wifi5', mimo: 2, supports5: true },
  pc: { wifiGen: 'wifi6', mimo: 2, supports5: true },
}

export const AP_PRESET_IDS: ApPreset[] = ['isp', 'wifi5', 'wifi6', 'mesh', 'repeater']
export const CLIENT_PRESET_IDS: ClientPreset[] = ['phone', 'laptop', 'tv', 'console', 'pc']
