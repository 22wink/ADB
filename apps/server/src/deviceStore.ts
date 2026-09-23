import fs from "node:fs";
import path from "node:path";

export type SavedDevice = {
  id: string;
  serial: string;
  model?: string;
  brand?: string;
  /** 无线地址 host:port，USB 可为空 */
  address?: string;
  transport?: "usb" | "wifi";
  lastSeenAt: string;
  lastConnectedAt: string;
  /** 用户备注 */
  note?: string;
  /** 固定到历史列表顶部 */
  pinned?: boolean;
};

type StoreFile = { devices: SavedDevice[] };

const MAX_DEVICES = 50;

function sortDevices(devices: SavedDevice[]): SavedDevice[] {
  return [...devices].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.lastConnectedAt.localeCompare(a.lastConnectedAt);
  });
}

export class DeviceStore {
  private file: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "devices.json");
    if (!fs.existsSync(this.file)) {
      this.write({ devices: [] });
    }
  }

  private read(): StoreFile {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const data = JSON.parse(raw) as StoreFile;
      if (!Array.isArray(data.devices)) return { devices: [] };
      return data;
    } catch {
      return { devices: [] };
    }
  }

  private write(data: StoreFile) {
    const tmp = this.file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, this.file);
  }

  /** 超限时优先保留已固定设备 */
  private trim(devices: SavedDevice[]): SavedDevice[] {
    if (devices.length <= MAX_DEVICES) return devices;
    const pinned = devices.filter((d) => d.pinned);
    const unpinned = devices.filter((d) => !d.pinned);
    const room = Math.max(0, MAX_DEVICES - pinned.length);
    return [...pinned, ...unpinned.slice(0, room)];
  }

  list(): SavedDevice[] {
    return sortDevices(this.read().devices);
  }

  upsert(
    partial: Omit<SavedDevice, "lastSeenAt" | "lastConnectedAt"> & {
      lastSeenAt?: string;
      lastConnectedAt?: string;
      touchConnected?: boolean;
    },
  ): SavedDevice {
    const data = this.read();
    const now = new Date().toISOString();
    const idx = data.devices.findIndex(
      (d) => d.id === partial.id || d.serial === partial.serial,
    );
    if (idx >= 0) {
      const prev = data.devices[idx]!;
      const next: SavedDevice = {
        ...prev,
        ...partial,
        id: partial.id || prev.id,
        serial: partial.serial || prev.serial,
        // 连接刷新不覆盖用户备注 / 固定状态
        note: partial.note !== undefined ? partial.note : prev.note,
        pinned: partial.pinned !== undefined ? partial.pinned : prev.pinned,
        lastSeenAt: partial.lastSeenAt ?? now,
        lastConnectedAt: partial.touchConnected
          ? now
          : (partial.lastConnectedAt ?? prev.lastConnectedAt),
      };
      data.devices[idx] = next;
      data.devices = this.trim(data.devices);
      this.write(data);
      return next;
    }
    const created: SavedDevice = {
      id: partial.id,
      serial: partial.serial,
      model: partial.model,
      brand: partial.brand,
      address: partial.address,
      transport: partial.transport,
      note: partial.note,
      pinned: partial.pinned,
      lastSeenAt: now,
      lastConnectedAt: now,
    };
    data.devices.unshift(created);
    data.devices = this.trim(data.devices);
    this.write(data);
    return created;
  }

  /** 更新备注 / 固定 */
  patch(
    id: string,
    patch: { note?: string; pinned?: boolean },
  ): SavedDevice | null {
    const data = this.read();
    const idx = data.devices.findIndex((d) => d.id === id || d.serial === id);
    if (idx < 0) return null;
    const prev = data.devices[idx]!;
    const next: SavedDevice = { ...prev };
    if (patch.note !== undefined) {
      const trimmed = patch.note.trim();
      next.note = trimmed || undefined;
    }
    if (patch.pinned !== undefined) {
      next.pinned = patch.pinned || undefined;
    }
    data.devices[idx] = next;
    this.write(data);
    return next;
  }

  remove(id: string): boolean {
    const data = this.read();
    const before = data.devices.length;
    data.devices = data.devices.filter((d) => d.id !== id && d.serial !== id);
    this.write(data);
    return data.devices.length < before;
  }
}
