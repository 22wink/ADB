const API = "";

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "请求失败");
    return data as T;
  }
  const text = await res.text();
  if (!res.ok) throw new Error(text || "请求失败");
  return text as T;
}

export type Device = {
  serial: string;
  state: string;
  product?: string;
  model?: string;
  device?: string;
};

export type SavedDevice = {
  id: string;
  serial: string;
  model?: string;
  brand?: string;
  address?: string;
  transport?: "usb" | "wifi";
  lastSeenAt: string;
  lastConnectedAt: string;
  note?: string;
  pinned?: boolean;
};

export type LanHost = {
  address: string;
  host: string;
  port: number;
  source: string[];
  name?: string;
  service?: string;
};

export type RemoteEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  mtime?: string;
};

export type PackageInfo = {
  packageName: string;
  label?: string;
  versionName?: string;
  versionCode?: string;
  apkPath?: string;
  dataDir?: string;
  installer?: string;
  firstInstallTime?: string;
  lastUpdateTime?: string;
  minSdk?: string;
  targetSdk?: string;
  uid?: string;
  enabled?: boolean;
  system?: boolean;
};

export type PackageScope = "third" | "system" | "all";

export const api = {
  health: () =>
    request<{ ok: boolean; version: string; mock?: boolean }>("/api/health"),
  devices: () =>
    request<{ devices: Device[]; history: SavedDevice[] }>("/api/devices"),
  history: () =>
    request<{ history: SavedDevice[] }>("/api/devices/history"),
  forgetDevice: (id: string) =>
    request<{ ok: boolean }>(
      `/api/devices/history/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  updateHistory: (id: string, patch: { note?: string; pinned?: boolean }) =>
    request<{ ok: boolean; device: SavedDevice; history: SavedDevice[] }>(
      `/api/devices/history/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      },
    ),
  lanSubnets: () => request<{ subnets: string[] }>("/api/lan/subnets"),
  lanDiscover: () =>
    request<{ subnets: string[]; hosts: LanHost[] }>("/api/lan/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    }),
  pair: (address: string, code: string) =>
    request("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, code }),
    }),
  props: (serial?: string) =>
    request<{ props: Record<string, string> }>(
      `/api/device/props${serial ? `?serial=${encodeURIComponent(serial)}` : ""}`,
    ),
  packages: (serial?: string, scope: PackageScope = "third") =>
    request<{ packages: PackageInfo[] }>(
      `/api/packages?scope=${scope}${serial ? `&serial=${encodeURIComponent(serial)}` : ""}`,
    ),
  connect: (address: string) =>
    request("/api/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }),
  disconnect: (address?: string) =>
    request("/api/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }),
  uninstall: (packageName: string, serial?: string) =>
    request("/api/packages/uninstall", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageName, serial }),
    }),
  launch: (packageName: string, serial?: string) =>
    request("/api/packages/launch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageName, serial }),
    }),
  forceStop: (packageName: string, serial?: string) =>
    request("/api/packages/force-stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageName, serial }),
    }),
  clearData: (packageName: string, serial?: string) =>
    request("/api/packages/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packageName, serial }),
    }),
  install: async (
    file: File,
    serial?: string,
    mode: "normal" | "replace" | "clean" = "replace",
    packageName?: string,
  ) => {
    const fd = new FormData();
    fd.append("apk", file);
    fd.append("mode", mode);
    if (packageName?.trim()) fd.append("packageName", packageName.trim());
    const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
    return request(`/api/install${q}`, { method: "POST", body: fd });
  },
  screenshot: (serial?: string) =>
    request<{ ok: boolean; url: string }>("/api/screenshot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial }),
    }),
  logcat: (serial?: string, lines = 200) =>
    request<string>(
      `/api/logcat?lines=${lines}${serial ? `&serial=${encodeURIComponent(serial)}` : ""}`,
    ),
  clearLogcat: (serial?: string) =>
    request("/api/logcat/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serial }),
    }),
  reboot: (mode: "system" | "bootloader", serial?: string) =>
    request("/api/reboot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, serial }),
    }),
  inputKey: (keycode: string, serial?: string) =>
    request("/api/input/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keycode, serial }),
    }),
  inputText: (text: string, serial?: string) =>
    request("/api/input/text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, serial }),
    }),
  fsList: (remotePath: string, serial?: string) =>
    request<{ path: string; entries: RemoteEntry[] }>(
      `/api/fs/list?path=${encodeURIComponent(remotePath)}${
        serial ? `&serial=${encodeURIComponent(serial)}` : ""
      }`,
    ),
  fsMkdir: (remotePath: string, serial?: string) =>
    request("/api/fs/mkdir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: remotePath, serial }),
    }),
  fsDelete: (remotePath: string, recursive: boolean, serial?: string) =>
    request("/api/fs/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: remotePath, recursive, serial }),
    }),
  fsUpload: async (file: File, remoteDir: string, serial?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("path", remoteDir);
    const q = serial ? `?serial=${encodeURIComponent(serial)}` : "";
    return request(`/api/fs/upload${q}`, { method: "POST", body: fd });
  },
  fsDownloadUrl: (remotePath: string, serial?: string) =>
    `/api/fs/download?path=${encodeURIComponent(remotePath)}${
      serial ? `&serial=${encodeURIComponent(serial)}` : ""
    }`,
};
