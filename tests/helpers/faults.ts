/**
 * Programmable network-fault injection via Toxiproxy (TEST-ONLY).
 *
 * The full negative-scenario catalog: latency, timeout, connection-cut,
 * bandwidth, partial reads — far richer than simply stopping the container, and
 * with instant recovery. Unlike a mock, the REAL keria stays up and serves real
 * responses
 * — we only degrade the real connection to it, so the app's real runtime behaviour
 * (timeouts, resets, real error strings) is exercised, not an assumed one.
 *
 * Requires the fault overlay (toxiproxy fronts keria transparently on 39xx, so the
 * app config is unchanged):
 *   docker compose -f docker-compose.yaml -f docker-compose.fault.yaml up -d keria witnesses toxiproxy
 * The control API is loopback-bound and unauthenticated — TEST ONLY.
 */
const TOXIPROXY_API = process.env.TOXIPROXY_API ?? "http://127.0.0.1:8474";

export type ProxyName = "keria_connect" | "keria_agent" | "keria_boot";

async function api(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${TOXIPROXY_API}${path}`, {
    signal: AbortSignal.timeout(10000),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  // Throw on ANY non-2xx (incl. 404) — a 404 here means a mistyped/absent proxy
  // name, which must fail loudly, not silently no-op a fault.
  if (!res.ok) {
    throw new Error(`toxiproxy ${path} -> ${res.status}: ${await res.text()}`);
  }
  return res;
}

/** Degrade: add `ms` latency (+ optional jitter) to every byte on the proxy. */
export async function addLatency(
  proxy: ProxyName,
  ms: number,
  jitter = 0
): Promise<void> {
  await api(`/proxies/${proxy}/toxics`, {
    method: "POST",
    body: JSON.stringify({ type: "latency", attributes: { latency: ms, jitter } }),
  });
}

/** Cut the path (disable the proxy) — like a partition; keria itself stays UP. */
export async function cutConnection(proxy: ProxyName): Promise<void> {
  await api(`/proxies/${proxy}`, {
    method: "POST",
    body: JSON.stringify({ enabled: false }),
  });
}

/** Flap the path: cut/restore `cycles` times at `ms` spacing, leaving it restored. */
export async function flap(
  proxy: ProxyName,
  cycles = 5,
  ms = 1000
): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await cutConnection(proxy);
    await new Promise((r) => setTimeout(r, ms));
    await restore(proxy);
    await new Promise((r) => setTimeout(r, ms));
  }
}

/** Restore a proxy to healthy: clear all toxics and re-enable. */
export async function restore(proxy: ProxyName): Promise<void> {
  const toxics = (await (await api(`/proxies/${proxy}/toxics`)).json()) as Array<{
    name: string;
  }>;
  for (const toxic of toxics) {
    await api(`/proxies/${proxy}/toxics/${toxic.name}`, { method: "DELETE" });
  }
  await api(`/proxies/${proxy}`, {
    method: "POST",
    body: JSON.stringify({ enabled: true }),
  });
}

/** Run `fn` with a fault applied (via `apply`), ALWAYS restoring afterward. */
export async function withFault(
  proxy: ProxyName,
  apply: () => Promise<void>,
  fn: () => Promise<void>
): Promise<void> {
  await apply();
  try {
    await fn();
  } finally {
    await restore(proxy);
  }
}
