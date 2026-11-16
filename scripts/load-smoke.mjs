/**
 * Small, polite load smoke test (no dependencies).
 *
 *   node scripts/load-smoke.mjs <baseUrl> [concurrency=10] [seconds=30] [path=/api/health] ...
 *
 * Reports throughput, error rate and latency percentiles per path. Use a staging/preview
 * environment for real load tests: production rate limits (per IP) intentionally throttle a
 * single client, and test traffic should not hit live hotels.
 */
const [base, conc = "10", secs = "30", ...paths] = process.argv.slice(2);
if (!base) {
  console.error("Usage: node scripts/load-smoke.mjs <baseUrl> [concurrency] [seconds] [paths...]");
  process.exit(1);
}
const targets = paths.length ? paths : ["/api/health"];

async function run(path) {
  const latencies = [];
  const statuses = {};
  let errors = 0;
  const deadline = Date.now() + Number(secs) * 1000;
  async function worker() {
    while (Date.now() < deadline) {
      const t = performance.now();
      try {
        const res = await fetch(base + path, { redirect: "manual", headers: { "user-agent": "hotel-saas-load-smoke" } });
        await res.arrayBuffer();
        statuses[res.status] = (statuses[res.status] ?? 0) + 1;
        if (res.status >= 500) errors++;
      } catch {
        errors++;
      }
      latencies.push(performance.now() - t);
    }
  }
  const started = performance.now();
  await Promise.all(Array.from({ length: Number(conc) }, worker));
  const elapsed = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const p = (q) => Math.round(latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))]);
  return {
    path,
    requests: latencies.length,
    rps: +(latencies.length / elapsed).toFixed(1),
    errors,
    statuses,
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
    max: Math.round(latencies.at(-1)),
  };
}

for (const path of targets) {
  const r = await run(path);
  console.log(JSON.stringify(r));
}
