import { Container } from "@cloudflare/containers";

/**
 * Number of interchangeable container instances to spread traffic across.
 * weserv/images is a stateless image proxy, so any instance can serve any
 * request. Keep this <= `max_instances` in wrangler.jsonc.
 *
 * Note: each container keeps its own local nginx proxy cache, so spreading
 * requests lowers local cache-hit rate — but Cloudflare's edge CDN caches
 * responses in front of the Worker anyway, which is the primary cache layer.
 */
const INSTANCES = 5;

export class WeservContainer extends Container {
  // nginx's public listener is on 8080 (non-privileged, matching the working
  // Node control container which serves reliably on 8080).
  defaultPort = 8080;

  sleepAfter = "15m";

  // Raise the port-ready timeout well above the library default of 20s. On a
  // cold start the Firecracker microVM has to boot and load the ~700MB image,
  // then nginx initializes libvips — this can take ~25s, just over the default,
  // which made Cloudflare give up ("Failed to verify port 80 after 20100ms")
  // and return 500 even though nginx was about to come up fine.
  override async startAndWaitForPorts(
    portsOrArgs?: unknown,
    cancellationOptions?: { portReadyTimeoutMS?: number; [k: string]: unknown },
    startOptions?: unknown,
  ): Promise<void> {
    return super.startAndWaitForPorts(
      portsOrArgs as never,
      { instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 120_000, ...cancellationOptions },
      startOptions as never,
    );
  }

  override onStart() {
    console.log("weserv container started");
  }

  override onError(error: unknown) {
    console.error("weserv container error:", error);
  }
}

interface Env {
  WESERV_CONTAINER: DurableObjectNamespace<WeservContainer>;
}

// Lightweight request used to warm an instance (served by nginx without any
// upstream fetch, so it's fast and cheap).
const WARM_REQUEST = new Request("https://warm.local/clear-cache");

async function warmInstance(
  env: Env,
  index: number,
): Promise<void> {
  const container = env.WESERV_CONTAINER.getByName(`weserv-${index}`);
  // Starting the container (if needed) + a cheap fetch renews its activity
  // timer so it doesn't sleep. Swallow errors — a failed warm-up (e.g. the
  // account's container capacity is momentarily unavailable) is retried on the
  // next cron tick.
  try {
    await container.fetch(WARM_REQUEST.clone());
  } catch {
    // ignore — next tick retries
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Pick a random instance from the pool and forward the request unchanged.
    const index = Math.floor(Math.random() * INSTANCES);
    const container = env.WESERV_CONTAINER.getByName(`weserv-${index}`);
    return container.fetch(request);
  },

  // Cron-triggered keep-warm: ping every instance so they stay provisioned and
  // never scale to zero (this is how the container avoids cold-start failures
  // during flaky provisioning — matching the always-warm working deployment).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const warmAll = Promise.all(
      Array.from({ length: INSTANCES }, (_v, i) => warmInstance(env, i)),
    );
    ctx.waitUntil(warmAll);
    await warmAll;
  },
} satisfies ExportedHandler<Env>;
