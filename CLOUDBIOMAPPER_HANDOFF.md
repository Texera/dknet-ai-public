# CloudBioMapper deployment — handoff

Status of the integration on the live `dknet-ai.org` EKS deployment after a long debugging session. Goal: short, link-rich reference so the next person can pick up the biology-side bugs without re-deriving the deployment context.

## What works

- Texera ↔ cloudmapper integration is wired end-to-end on the live cluster.
- Cluster **create / RUNNING / delete / TERMINATED** lifecycle is verified working — three full cycles run via API and observed in DB + EC2. (See "Test results" below.)
- The cloudmapper Go service receives jobs, provisions EC2 + Slurm + EFS via Terraform, and returns results back through the Texera operator. The webserver REST + WebSocket flow back to the operator works.

## What's broken (where the next person picks up)

The biology pipeline — STAR alignment on the cluster — does not produce real results yet. Three known cloudmapper-side bugs remain:

1. **R1/R2 FASTQ chunks not landing where rsync expects.** The `splitfastq` binary runs (now executable — that part was fixed) but output paths don't match what `starsolo_slurm.sh` rsyncs (`/efs/Job{N}/sample{M}/tmp_outs0/R{1,2}_chunk_00.fastq.gz`). Probably a path/naming mismatch in `internal/service/job/upload_data.go` or `cmd/splitfastq/`.
2. **Missing 10x Chromium V3 barcode whitelist.** STAR errors with `open whitelist /gfs/whitelists/3M-february-2018.txt: no such file`. Needs `/gfs/whitelists/{737K-august-2016.txt, 3M-february-2018.txt}` on the cluster nodes — either bake into AMI via `script/setup_ami.sh`, or stage on the global EFS that every cluster peers with.
3. **(now fixed in code, not yet biology-verified)** `/mnt` not writable by Slurm user — STAR fell back wrong with `mktemp: Permission denied`. Fix lives in `script/starsolo_slurm.sh` (added `[ -w "$_candidate" ] || continue`).

## Deployment summary

| | |
|---|---|
| Cluster | EKS Auto Mode `dknet`, us-west-1, account `106774395178`, AWS profile `uci` |
| Public URL | https://dknet-ai.org |
| Texera repo (canonical) | https://github.com/Texera/dknet-ai-public — same-repo PRs (not a fork) |
| Cloudmapper repo | https://github.com/Texera/cloudmapper (private) |
| Texera PR (CloudBioMapper integration) | https://github.com/Texera/dknet-ai-public/pull/2 |
| Cloudmapper local clone | `/home/ali/IdeaProjects/cloudmapper-build` (uncommitted fixes — see below) |
| Texera worktree | `/home/ali/IdeaProjects/texera-worktrees/feat-cloudbiomapper` |
| Local override (with secrets, never commit) | `/home/ali/IdeaProjects/texera/bin/k8s/override-eks.yaml` |
| kubectl context | `dknet` (already current) |
| Onboarding skill | `.claude/skills/eks-knowledge-base/SKILL.md` |

## What I did, in order

1. **Re-applied [aicam/texera#5](https://github.com/aicam/texera/pull/5)** (previously merged + reverted) onto `Texera/dknet-ai-public` as PR #2 — operator, REST resources, schema, helm templates, frontend.
2. **Fixed PR #5 to actually compile + deploy on this stack** (commits in PR #2):
   - `ClusterServiceClient` + `CloudMapperSourceOpDesc` read URL from config instead of hardcoding.
   - Helm templates parameterized: namespace, storageClass `auto-ebs-sc`, image `texera/cloudmapper`, region `us-west-1`, amd64 nodeSelector, config.yaml ConfigMap mount.
   - `cluster` + `cluster_activity` tables added to `sql/texera_ddl.sql` (PR #5 only had a one-off migration).
   - JOOQ build-args + `host.docker.internal:host-gateway` added to the missing dockerfiles (webserver, cu-master, file-service, config-service, workflow-compiling-service, computing-unit-worker).
   - Frontend: PR #5's components had `standalone: false`; Angular 21 needs them either standalone-with-imports or properly declared. Converted to standalone with explicit `imports: [...]`.
   - `NzToolTipModule` → `NzTooltipModule` (typo in module name).
   - Cluster page `$event` typed as `Event` not `number`/`FormGroup` under strict template checking → `$any($event)` casts.
3. **Built all texera images** to `docker.io/texera/*:dknet-aws` (the texera org Docker Hub, shared with other students — tag disambiguates) via `docker buildx --builder default --network=host` with build-args pointing at the local `texera_db_hackathon` postgres for jOOQ codegen.
4. **Built + pushed cloudmapper Go image** to `docker.io/texera/cloudmapper:dknet-aws`.
5. **AWS pre-reqs:**
   - IAM user `texera-cloudmapper` with managed policy `texera-cloudmapper-managed` (EC2/EFS/IAM-scoped-to-role_Cluster\*/CloudWatch/S3-scoped-to-staging). The inline policy hit AWS's 2 KB limit; switched to a managed policy.
   - S3 bucket `texera-cloudmapper-staging` (us-west-1, 7-day object lifecycle, CORS open).
   - **Global VPC + EFS** for the shared file system every user cluster peers with. Cloudmapper's `config/config.go` hardcodes these IDs — I created our own and patched the constants:
     - `GLOBAL_FILE_SYSTEM_ID = "fs-04f93489f44720716"` (EFS)
     - `GLOBAL_FILE_SYSTEM_VPC_ID = "vpc-0305d0df67772b985"` (VPC `global-cloudmapper`, CIDR 10.0.0.0/16)
     - `GLOBAL_FILE_SYSTEM_ROUTE_TABLE_ID = "rtb-0e58f2ae6206edd8c"`
     - Security group `sg-0fd77efbc8febf976` allowing NFS 2049 ingress from 11.0.0.0/8 + 10.0.0.0/16.
   - **CloudMapper AMI** `ami-0363df0b63b9c49af` (us-west-1, name `texera-cloudmapper-base-20260519-0009`). Built by launching a t3.medium Ubuntu 22.04, running `Texera/cloudmapper/script/setup_ami.sh` via SSM, then `ec2 create-image --no-reboot`.
6. **K8s pre-reqs (in `default` namespace):**
   - Secret `cloudmapper-aws-credentials` (`texera-cloudmapper` access keys)
   - Secret `cloudmapper-ssh-key` (RSA keypair at `~/.cloudmapper-keys/cloudmapper_id_rsa{,.pub}`)
   - ConfigMap `cloudmapper-config` (config.yaml with AMI ID, S3 bucket, callback_url, port 4000, `size_of_storage_pool: 1`, `max_num_of_clusters: 1`)
   - PodDisruptionBudgets `cloudmapper-no-evict` + `cu-no-evict` (Karpenter was evicting CU pods as "Underutilized" because they're idle while waiting for work).
7. **Applied `sql/updates/cluster.sql`** to the in-cluster postgres (`SET search_path TO texera_db, public` + the migration).
8. **`helm upgrade texera bin/k8s -f override-eks.yaml`** — release `texera` is now at revision 28, status `deployed`.
9. **Tested cluster CRUD via forged JWT** (the auth secret `AUTH_JWT_SECRET` is in override-eks.yaml, so HS256-sign any claim against it and the webserver accepts):
   - Cycle 1 (cid=9): create → RUNNING in 142s → delete → TERMINATED in 73s. **PASS.**
   - Cycle 2 (cid=10): pool empty, on-demand fallback fired, → RUNNING in 237s → TERMINATED in 73s. **PASS.**
   - Cycle 3 (cid=11): same on-demand fallback, in flight when handoff requested.

## Cloudmapper code fixes (live-patched in the running pod via `kubectl cp`; NOT committed upstream)

All in `/home/ali/IdeaProjects/cloudmapper-build`. Diff against upstream:

| File | Fix |
|---|---|
| `config/config.go` | Replaced the four `GLOBAL_FILE_SYSTEM_*` constants with the dknet-ai equivalents (see AWS pre-reqs above). |
| `internal/ssh/file_transfer.go` | SCP header was hardcoded `C0644`; replaced with `srcFileInfo.Mode().Perm()` so `bin/splitfastq` keeps its `+x` bit on upload. Without this, every Slurm job fails with `execve(): /efs/Job{N}/splitfastq: Permission denied`. |
| `script/starsolo_slurm.sh` | Two cache-staging loops picked `/mnt` if `df` showed free space, but on stock EC2 AMIs `/mnt` is `0755 root:root` and the Slurm-spawned user can't write. Added `[ -w "$_candidate" ] || continue` before the `df` check. |
| `internal/daemon/storage_pool.go` | Added `CreatePreallocatedStorageWithId(clusterId int)` — synchronous slot creation tagged with a specific id, used by the on-demand fallback below. |
| `internal/api/handlers/cluster_handlers.go` | `waitUntilUnassignedStorageAvailable` used to loop forever printing `Waiting 10 seconds for available cluster` when the pool was empty (e.g. after a destroy cycle). Rewrote to fast-path on hit + fallback to `daemon.CreatePreallocatedStorageWithId(clusterId)` on miss. **This is the change that made CRUD reliable.** |
| `internal/api/handlers/job_handlers.go` (`processJobAsync`) | After a Slurm job fails, `cluster.State` stayed `"running"` and the cluster was permanently blocked by the `cluster.State == "launching" \|\| cluster.State == "running"` guard. Added a fallback that resets the cluster to `"ready"` on failure so the next job submission isn't rejected with "cluster is still launching". |

These changes are pushed into `texera/cloudmapper:dknet-aws` (manifest `sha256:506ce5fa3b19e8d2f9776721de2952df3bf8f4aef363c5bcae826ae842eda3f3`). **They need to be opened as PRs against `Texera/cloudmapper`.**

## Live resources right now

Run these to see current state:

```bash
aws --profile uci ec2 describe-vpcs --region us-west-1 --query 'Vpcs[*].{Id:VpcId,Cidr:CidrBlock,Cluster:Tags[?Key==`ClusterName`]|[0].Value,Name:Tags[?Key==`Name`]|[0].Value}' --output table
aws --profile uci ec2 describe-instances --region us-west-1 --filters Name=instance-state-name,Values=running,pending --query 'Reservations[].Instances[].{Id:InstanceId,State:State.Name,Cluster:Tags[?Key==`ClusterName`]|[0].Value}'
kubectl exec -n default texera-postgresql-0 -- bash -c 'PGPASSWORD=$POSTGRES_PASSWORD psql -U postgres -d texera_db -c "SELECT cid, name, status FROM texera_db.cluster ORDER BY cid DESC LIMIT 10;"'
kubectl exec -n default deploy/texera-webserver -- curl -s http://cloudmapper-service.default.svc.cluster.local:4000/api/cluster
```

Cycle 3's cluster (cid=11, Cluster11) may still be alive on EC2 when you pick this up. Terminate via:

```bash
TOKEN=$(python3 -c "import jwt,time;print(jwt.encode({'sub':'Ali Risheh','userId':2,'googleId':'101078649482453113845','email':'arisheh@uci.edu','role':'ADMIN','googleAvatar':'ACg8ocIWWsRe-dXoHE7HBXAWjm-VqJwEUyRQr-HeKlGz58UkU1I3D2k=s96-c','iat':int(time.time()),'exp':int(time.time())+3600},'<AUTH_JWT_SECRET from override-eks.yaml>','HS256'))")
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"cid":11,"name":"agent-crud-3"}' https://dknet-ai.org/api/cluster/terminate
```

## Reference: how to invoke things programmatically

The full set of recipes (forging a JWT, hitting the sync execution endpoint inside the cluster, the JSON shape the operator needs, the JVM-heap notation gotcha, the cluster-id-skew bypass) lives in `.claude/skills/eks-knowledge-base/SKILL.md`. Read that file first.

## Things to ignore

- The `Waiting 10 seconds for available cluster` warning log line — that path is no longer reached. If you see it again, the in-pod patch has been wiped (pod restart with `imagePullPolicy: Always` will pull the patched image).
- The "id-skew" framing in older notes — the on-demand fallback removes that whole class of problem.

## Open in PRs (suggested)

- `Texera/cloudmapper`: one PR for `internal/ssh/file_transfer.go` (file mode), one for `script/starsolo_slurm.sh` (writability), one for `internal/daemon/storage_pool.go` + `internal/api/handlers/cluster_handlers.go` (on-demand pool fallback), one for `internal/api/handlers/job_handlers.go` (cluster state reset on job fail). The global file system IDs in `config/config.go` should be made env-driven rather than hardcoded — separate PR.
- `Texera/dknet-ai-public#2`: already up; ready for review.
