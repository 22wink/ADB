import os from "node:os";
import net from "node:net";

function isPrivateIPv4(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/** 本机所在的私网网段（/24） */
export function localSubnets(): string[] {
  const nets = os.networkInterfaces();
  const prefixes = new Set<string>();
  for (const list of Object.values(nets)) {
    if (!list) continue;
    for (const item of list) {
      if (item.family !== "IPv4" && (item.family as unknown) !== 4) continue;
      if (item.internal) continue;
      if (!isPrivateIPv4(item.address)) continue;
      const parts = item.address.split(".");
      prefixes.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }
  return [...prefixes];
}

function probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

export type LanHost = {
  address: string;
  host: string;
  port: number;
  source: "port-scan" | "mdns";
  name?: string;
  service?: string;
};

/**
 * 扫描本机局域网 /24 的常见 ADB 端口。
 * 仅私网；限制并发，避免打满路由器。
 */
export async function scanAdbPorts(opts?: {
  ports?: number[];
  concurrency?: number;
  timeoutMs?: number;
}): Promise<LanHost[]> {
  const ports = opts?.ports ?? [5555];
  const concurrency = Math.min(Math.max(opts?.concurrency ?? 32, 4), 64);
  const timeoutMs = Math.min(Math.max(opts?.timeoutMs ?? 350, 100), 1500);
  const prefixes = localSubnets();
  const targets: { host: string; port: number }[] = [];

  for (const prefix of prefixes) {
    for (let i = 1; i <= 254; i++) {
      const host = `${prefix}.${i}`;
      for (const port of ports) {
        targets.push({ host, port });
      }
    }
  }

  const found: LanHost[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const idx = cursor++;
      const t = targets[idx]!;
      const ok = await probeTcp(t.host, t.port, timeoutMs);
      if (ok) {
        found.push({
          address: `${t.host}:${t.port}`,
          host: t.host,
          port: t.port,
          source: "port-scan",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length || 1) }, () =>
      worker(),
    ),
  );

  found.sort((a, b) => a.address.localeCompare(b.address));
  return found;
}
