# Texera monitoring (Prometheus + Grafana)

Prod-style observability stack for the Texera EKS cluster. Lives in the
`monitoring` namespace and is fronted by the existing Envoy gateway at
`https://dknet-ai.org`.

## Access

- **URL:** https://dknet-ai.org/grafana
- **Username:** `arisheh`
- **Password:** stored in K8s Secret `monitoring/grafana-admin`. Retrieve with:

  ```bash
  kubectl get secret grafana-admin -n monitoring \
    -o jsonpath='{.data.admin-password}' | base64 -d ; echo
  ```

If the password is ever rotated, redeploy the secret with a new
`--from-literal=admin-password=...` and restart the Grafana pod.

## Components

| Component | Purpose | Helm release | Namespace |
|----|----|----|----|
| `kube-prometheus-stack` | Prometheus + Grafana + node-exporter + kube-state-metrics + Operator | `kps` | `monitoring` |
| `prometheus-postgres-exporter` | Scrapes `texera-postgresql` for `pg_*` engine metrics | `pg-exporter` | `monitoring` |
| `grafana-datasource-postgres` | Provisions a Postgres datasource so panels can issue raw SQL against `texera_db` | (ConfigMap) | `monitoring` |
| `grafana-route` | HTTPRoute on `texera-gateway` that maps `/grafana` → `kps-grafana` | (HTTPRoute) | `default` |
| `allow-default-httproute-to-grafana` | ReferenceGrant authorising the cross-ns backendRef | (ReferenceGrant) | `monitoring` |

Alertmanager is intentionally disabled — the user asked for visibility, not paging.

## Datasources

- **Prometheus** (uid: `prometheus`) — bundled by `kube-prometheus-stack`.
- **Texera-Postgres** (uid: `texera-pg`) — direct read against
  `texera-postgresql.default.svc.cluster.local:5432`. The password is
  injected into the Grafana pod as `$POSTGRES_PASSWORD` via
  `envValueFrom.secretKeyRef` (secret `monitoring/texera-postgresql`,
  replicated from `default/texera-postgresql`).

## Dashboards

All three live in the **Texera** folder:

1. **Texera — Overview** (`texera-overview`)
   Stat tiles: users / workflows / executions / active CUs / datasets / projects.
   Time series: signups per day, workflows per day, executions per hour by status.
   Pie: user role breakdown.
   Tables: top users by workflow count, recent executions.

2. **Texera — Execution Performance** (`texera-execution-perf`)
   Stat tiles: running, started 24h, failed 24h, avg/p95/max duration 24h.
   Histogram of execution durations, status breakdown, duration over time, recent failed executions, runtime-stats payload.

3. **Texera — Cluster & Pod Health** (`texera-cluster-health`)
   Pod counts (overall and CU-specific), restart counts, cluster CPU/memory in use.
   Per-pod CPU and memory for `default` and `texera-workflow-computing-unit-pool`.
   Postgres connections by state, database sizes, recent pod restarts.

The first two dashboards work entirely off the **Texera-Postgres**
datasource (live SQL — always current). The third runs against
**Prometheus** and is therefore subject to Prometheus's scrape interval
(30s) and retention (15d).

## Deploying / re-deploying

After changing any values file or dashboard JSON:

```bash
# Re-apply kube-prometheus-stack:
helm upgrade --install kps prometheus-community/kube-prometheus-stack \
  --namespace monitoring --version 84.5.0 \
  -f bin/k8s/monitoring/values-kube-prometheus-stack.yaml

# Re-apply postgres-exporter:
helm upgrade --install pg-exporter \
  prometheus-community/prometheus-postgres-exporter \
  --namespace monitoring --version 8.0.0 \
  -f bin/k8s/monitoring/values-postgres-exporter.yaml

# Datasource + HTTPRoute:
kubectl apply -f bin/k8s/monitoring/manifests/grafana-datasource-postgres.yaml
kubectl apply -f bin/k8s/monitoring/manifests/httproute-grafana.yaml

# Dashboards (sidecar hot-reloads them; no Grafana restart needed):
for f in bin/k8s/monitoring/dashboards/*.json; do
  name="dashboard-texera-$(basename "$f" .json)"
  kubectl create configmap "$name" \
    --namespace monitoring \
    --from-file="$(basename "$f")=$f" \
    --dry-run=client -o yaml | \
    kubectl label --local -f - grafana_dashboard=1 grafana_folder=Texera \
      --dry-run=client -o yaml | \
    kubectl apply -f -
done
```

`bin/k8s/monitoring/deploy.sh` wraps all of the above for convenience.

## Notes / gotchas

- **The Grafana Postgres datasource is read-only by convention but not
  by enforcement.** It uses the postgres superuser (same one all Texera
  services use). If you need to lock it down, create a `grafana_ro` role
  with `pg_read_all_data` and switch the datasource to that.
- **Cross-namespace HTTPRoute → Service** requires the `ReferenceGrant`
  in the `monitoring` namespace. If the route ever 404s, check that the
  ReferenceGrant still exists.
- **Engine-level Amber metrics** (per-operator throughput, tuple counts)
  are persisted as protobuf files referenced by
  `workflow_executions.runtime_stats_uri`. They are not currently
  exposed to Prometheus. Adding that would need a new collector that
  reads the protobufs and emits Prom metrics — out of scope for this
  initial setup; the existing dashboards cover everything queryable
  directly.
- **Alertmanager datasource** appears in Grafana even though
  Alertmanager is disabled. It comes from the kps chart's defaults and
  is harmless (queries against it just fail). Remove via
  `grafana.additionalDataSources: []` override if it bothers you.
