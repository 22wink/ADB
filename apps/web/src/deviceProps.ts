export type PropMeta = {
  key: string;
  zh: string;
  en: string;
};

/** 概览默认展示 */
export const PRIMARY_PROPS: PropMeta[] = [
  { key: "ro.product.model", zh: "型号", en: "Model" },
  { key: "ro.product.brand", zh: "品牌", en: "Brand" },
  { key: "ro.product.manufacturer", zh: "厂商", en: "Manufacturer" },
  { key: "ro.product.name", zh: "产品名", en: "Product" },
  { key: "ro.product.device", zh: "设备代号", en: "Device" },
  { key: "ro.build.version.release", zh: "Android 版本", en: "Android" },
  { key: "ro.build.version.sdk", zh: "SDK", en: "SDK" },
  { key: "ro.serialno", zh: "序列号", en: "Serial" },
  { key: "ro.product.cpu.abi", zh: "CPU ABI", en: "ABI" },
  { key: "wm.size", zh: "分辨率", en: "Resolution" },
  { key: "battery.level", zh: "电量", en: "Battery" },
];

/** 展开后优先展示的详细项（按分组） */
export const DETAIL_GROUPS: { titleZh: string; titleEn: string; items: PropMeta[] }[] =
  [
    {
      titleZh: "产品信息",
      titleEn: "Product",
      items: [
        { key: "ro.product.board", zh: "主板", en: "Board" },
        { key: "ro.product.cpu.abilist", zh: "ABI 列表", en: "ABI list" },
        { key: "ro.hardware", zh: "硬件", en: "Hardware" },
        { key: "ro.boot.serialno", zh: "启动序列号", en: "Boot serial" },
      ],
    },
    {
      titleZh: "系统构建",
      titleEn: "Build",
      items: [
        { key: "ro.build.id", zh: "构建 ID", en: "Build ID" },
        { key: "ro.build.display.id", zh: "显示版本", en: "Display ID" },
        { key: "ro.build.type", zh: "构建类型", en: "Type" },
        { key: "ro.build.tags", zh: "标签", en: "Tags" },
        { key: "ro.build.version.security_patch", zh: "安全补丁", en: "Security patch" },
        { key: "ro.build.version.incremental", zh: "增量版本", en: "Incremental" },
        { key: "ro.build.fingerprint", zh: "指纹", en: "Fingerprint" },
        { key: "ro.build.date", zh: "构建日期", en: "Build date" },
        { key: "ro.build.user", zh: "构建用户", en: "Build user" },
        { key: "ro.build.host", zh: "构建主机", en: "Build host" },
      ],
    },
    {
      titleZh: "显示与电池",
      titleEn: "Display & Battery",
      items: [
        { key: "wm.density", zh: "屏幕密度", en: "Density" },
        { key: "ro.sf.lcd_density", zh: "LCD 密度", en: "LCD density" },
        { key: "battery.status", zh: "电池状态码", en: "Battery status" },
        { key: "battery.health", zh: "电池健康码", en: "Battery health" },
        { key: "battery.temperature", zh: "电池温度", en: "Temperature" },
      ],
    },
    {
      titleZh: "其他",
      titleEn: "Other",
      items: [
        { key: "persist.sys.timezone", zh: "时区", en: "Timezone" },
        { key: "ro.crypto.state", zh: "加密状态", en: "Crypto state" },
        { key: "gsm.version.baseband", zh: "基带", en: "Baseband" },
        { key: "ro.bootloader", zh: "Bootloader", en: "Bootloader" },
        { key: "ro.debuggable", zh: "可调试", en: "Debuggable" },
        { key: "ro.secure", zh: "Secure", en: "Secure" },
      ],
    },
  ];

export function labelOf(meta: PropMeta): string {
  return meta.zh + " / " + meta.en;
}

export function valueOf(
  props: Record<string, string>,
  key: string,
): string {
  const v = props[key];
  if (v == null || v === "") return "—";
  return v;
}
