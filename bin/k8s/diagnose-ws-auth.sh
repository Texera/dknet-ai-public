#!/usr/bin/env bash
# Run on the server (e.g. ssh arisheh@texera-1.ics.uci.edu) with sudo so kubectl works.
# Usage: sudo -E KUBECONFIG=/etc/rancher/rke2/rke2.yaml bash diagnose-ws-auth.sh
# Or:    sudo KUBECONFIG=/etc/rancher/rke2/rke2.yaml bash /path/to/diagnose-ws-auth.sh

set -e
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/rke2/rke2.yaml}"

echo "========== 1. Pods in texera namespace =========="
kubectl get pods -n texera

echo ""
echo "========== 2. Envoy Gateway proxy pods (any namespace) =========="
kubectl get pods -A | grep -E "envoy|gateway" || true

# Find Envoy proxy pod (gateway deployment often in envoy-gateway-system or similar)
ENVOY_NS=""
ENVOY_POD=""
for ns in envoy-gateway-system envoy-gateway default; do
  ENVOY_POD=$(kubectl get pods -n "$ns" -o name 2>/dev/null | grep -i envoy | head -1 | sed 's|pod/||')
  if [[ -n "$ENVOY_POD" ]]; then
    ENVOY_NS="$ns"
    break
  fi
done
if [[ -z "$ENVOY_NS" ]]; then
  ENVOY_POD=$(kubectl get pods -A -o name 2>/dev/null | grep -i envoy | head -1)
  ENVOY_NS=$(kubectl get pods -A -o wide 2>/dev/null | grep -i envoy | head -1 | awk '{print $1}')
fi

echo ""
echo "========== 3. Envoy proxy pod (for logs) =========="
echo "Namespace: $ENVOY_NS  Pod: $ENVOY_POD"

if [[ -n "$ENVOY_POD" && -n "$ENVOY_NS" ]]; then
  echo ""
  echo "========== 4. Recent Envoy access logs (wsapi / upgrade / 403) =========="
  kubectl logs -n "$ENVOY_NS" "$ENVOY_POD" -c envoy --tail=200 2>/dev/null | grep -E "wsapi|upgrade|403" || echo "(no matching lines or no envoy container)"
  echo ""
  echo "========== 5. Envoy response_code_details (last 30 wsapi-related lines) =========="
  kubectl logs -n "$ENVOY_NS" "$ENVOY_POD" -c envoy --tail=500 2>/dev/null | grep -E "wsapi|workflow-websocket" | tail -30 || echo "(none)"
else
  echo "Could not find Envoy proxy pod. List all pods with: kubectl get pods -A | grep -i envoy"
fi

echo ""
echo "========== (Optional) Envoy config dump: route upgrade_configs for /wsapi =========="
if [[ -n "$ENVOY_POD" && -n "$ENVOY_NS" ]]; then
  kubectl exec -n "$ENVOY_NS" "$ENVOY_POD" -c envoy -- curl -s http://localhost:19000/config_dump 2>/dev/null | jq -r '
    .configs[] | select(."@type" == "type.googleapis.com/envoy.admin.v3.RoutesConfigDump")
    | .dynamic_route_configs[].route_config.virtual_hosts[].routes[]
    | select(.match.prefix == "/wsapi" or (.match.path_separated_prefix != null))
    | {prefix: .match.prefix, upgrade_configs: .route.upgrade_configs}
  ' 2>/dev/null || echo "jq/exec not available or no match"
fi

echo ""
echo "========== 6. Access-control pod(s) in texera =========="
AC_POD=$(kubectl get pods -n texera -o name 2>/dev/null | grep -i access-control | head -1 | sed 's|pod/||')
echo "Pod: $AC_POD"

if [[ -n "$AC_POD" ]]; then
  echo ""
  echo "========== 7. Auth requests in access-control logs (last 200 lines) =========="
  COUNT=$(kubectl logs -n texera "$AC_POD" --tail=200 2>/dev/null | grep -c -E "Authorizing|/api/auth|wsapi" || echo "0")
  echo "Count of auth-related log lines (last 200): $COUNT"
  echo ""
  echo "========== 8. Last 30 lines of access-control logs =========="
  kubectl logs -n texera "$AC_POD" --tail=30 2>/dev/null || true
fi

echo ""
echo "========== 9. HTTPRoute and SecurityPolicy in texera =========="
kubectl get httproute,securitypolicy -n texera 2>/dev/null || true

echo ""
echo "========== 10. SecurityPolicy targetRef (dynamic-routes) =========="
kubectl get securitypolicy -n texera -o yaml 2>/dev/null | grep -A5 targetRefs || true
