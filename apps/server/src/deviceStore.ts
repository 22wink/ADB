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
  note?: string;
};

type StoreFile = { devices: SavedDevice[] };

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

  list(): SavedDevice[] {
    return this.read().devices.sort((a, b) =>
      b.lastConnectedAt.localeCompare(a.lastConnectedAt),
    );
  }

  upsert( partial: Omit<SavedDevice, "lastSeenAt" | "lastConnectedAt"> & {
    lastSeenAt?: string;
    lastConnectedAt?: string;
    touchConnected?: boolean;
  }): SavedDevice {
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
        lastSeenAt: partial.lastSeenAt ?? now,
        lastConnectedAt: partial.touchConnected
          ? now
          : (partial.lastConnectedAt ?? prev.lastConnectedAt),
      };
      data.devices[idx] = next;
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
      lastSeenAt: now,
      lastConnectedAt: now,
    };
    data.devices.unshift(created);
    // 最多保留 50 台
    data.devices = data.devices.slice(0, 50);
    this.write(data);
    return created;
  }

  remove(id: string): boolean {
    const data = this.read();
    const before = data.devices.length;
    data.devices = data.devices.filter((d) => d.id !== id && d.serial !== id);
    this.write(data);
    return data.devices.length < before;
  }
}
