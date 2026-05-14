# Kubernetes Deployment

Refer to https://github.com/Texera/texera/wiki/Install-Texera for details.

## EKS Auto Mode — `dknet` cluster (us-west-1)

Snapshot of the production EKS Auto Mode deployment used at `dknet-ai.org`.
Resources and node placement are driven entirely by `override-eks.yaml` +
the chart templates, so a fresh `helm install` on a clean EKS reproduces
this layout.

### EC2 nodes

| Type | vCPU | RAM | Role | $/hr | $/mo (730h) |
|---|---|---|---|---|---|
| c5a.2xlarge | 8 | 16 GiB | CU warm placeholder (dedicated) | $0.3800 | $277.40 |
| c5a.2xlarge | 8 | 16 GiB | All texera services | $0.3800 | $277.40 |
| c5a.large | 2 | 4 GiB | postgresql + cert-manager (EBS-pinned to us-west-1a) | $0.0950 | $69.35 |
| c6g.large (ARM) | 2 | 4 GiB | System pods (us-west-1a) | $0.0848 | $61.90 |
| c6g.large (ARM) | 2 | 4 GiB | System pods (us-west-1c) | $0.0848 | $61.90 |
| **Totals** | **22** | **44 GiB** |  | **$1.0246** | **$747.95** |

Add ~$73/mo for the EKS control plane and ~$90/mo for the EKS Auto Mode
management surcharge, for a full bill of **~$910/mo** (excluding EBS,
NLB, CloudWatch, data transfer).

### Per-service resource requests

All texera services run with **requests only, no limits** — each may
burst into whatever the node has free; misbehavior shows up in metrics
rather than being silently throttled / OOMKilled.

| Service | CPU request | Memory request | Observed idle | Notes |
|---|---|---|---|---|
| `texera-webserver` | 200m | 1 GiB | 632 MiB | JVM |
| `texera-workflow-computing-unit-manager` | 200m | 1 GiB | 300 MiB | JVM |
| `texera-workflow-compiling-service` | 200m | 1 GiB | 356 MiB | JVM |
| `texera-file-service` | 200m | 1 GiB | 398 MiB | JVM |
| `texera-config-service` | 200m | 1 GiB | 291 MiB | JVM |
| `texera-access-control-service` | 200m | 1 GiB | 220 MiB | JVM |
| `texera-litellm` | 100m | 1 GiB | 860 MiB | Python |
| `texera-agent-service` | 50m | 128 MiB | 60 MiB | Bun/TypeScript |
| `texera-postgresql` | 200m | 256 MiB | 97 MiB | |
| `texera-cu-warm-placeholder` | **6** | **12 GiB** | n/a (pause container) | Reserves a warm node for instant CU launch |

### Cost drivers

- The CU warm placeholder ($277/mo) is the single largest line item. It
  reserves a 6 vCPU / 12 GiB slot so new computing units launch in ~15 s
  instead of waiting ~3 min for Karpenter to bring up a fresh node. To
  give up that latency for the cost, set
  `computingUnitWarmPool.enabled: false` in `override-eks.yaml`.
- Shrinking the placeholder's requests would let Karpenter pick a
  smaller (cheaper) node, but only at the cost of slower launches for
  CUs that exceed the new placeholder size.
- The two `c6g.large` system nodes ($124/mo combined) are placed in
  separate AZs for HA — collapsing to one would save ~$62/mo at the
  cost of system-pod AZ redundancy.
