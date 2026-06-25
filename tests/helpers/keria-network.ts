/**
 * Network-failure control for the KERIA backend, used by the offline e2e test.
 *
 * A real network failure is simulated by stopping the KERIA container: the
 * emulator's WebView fetch to keria then fails with "Failed to fetch", which the
 * app's online/offline state machine recognises (isNetworkError) and reacts to
 * exactly as on a real outage. `docker start` brings it back (the keria-data
 * volume persists agent state), so the same run can assert auto-reconnect.
 *
 * NOTE: `docker pause` is deliberately NOT used — a frozen container blackholes
 * the connection, so the fetch hangs on the client timeout instead of producing
 * a prompt "Failed to fetch", and the offline flip never lands in time.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

/** docker-compose container_name for the KERIA agent (see docker-compose.yaml). */
export const KERIA_CONTAINER = "idw-keria";

/** Stop KERIA (container down -> connection refused -> app detects offline). */
export async function stopKeria(container = KERIA_CONTAINER): Promise<void> {
  await exec("docker", ["stop", container]);
}

/** Start KERIA again. Idempotent: starting a running container is not an error. */
export async function startKeria(container = KERIA_CONTAINER): Promise<void> {
  await exec("docker", ["start", container]);
}
