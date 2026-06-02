<!--
Thanks for sending a pull request (PR)! Here are some tips for you:
  1. If this is your first time, please read our contributor guidelines: 
     [Contributing to Texera](https://github.com/apache/texera/blob/main/CONTRIBUTING.md)
  2. Ensure you have added or run the appropriate tests for your PR
  3. If the PR is work in progress, mark it a draft on GitHub.
  4. Please write your PR title to summarize what this PR proposes, we 
    are following Conventional Commits style for PR titles as well.
  5. Be sure to keep the PR description updated to reflect all changes.
-->

### What changes were proposed in this PR?
<!--
Please clarify what changes you are proposing. The purpose of this section 
is to outline the changes. Here are some tips for you:
  1. If you propose a new API, clarify the use case for a new API.
  2. If you fix a bug, you can clarify why it is a bug.
  3. If it is a refactoring, clarify what has been changed.
  3. It would be helpful to include a before-and-after comparison using 
     screenshots or GIFs.
  4. Please consider writing useful notes for better and faster reviews.
-->

This PR refactors the Texera networking layer by replacing the existing `ingress-nginx` controller and the standalone `envoy` proxy (used for Computing Units) with a unified **Envoy Gateway** implementation. This simplifies the architecture, consolidates routing logic, and leverages the modern Kubernetes Gateway API.

#### Key Changes:

1.  **Architecture Consolidation**:
    *   Removed `ingress-nginx` dependency.
    *   Removed the manually maintained minimal `envoy` deployment and config maps.
    *   Introduced **Envoy Gateway** as the single entry point for all traffic (UI, API, MinIO, and Computing Units).

2.  **Dynamic Routing & Authentication**:
    *   Migrated the custom Lua/ExtAuth logic from the old Envoy proxy into the **Access Control Service**.
    *   The Access Control Service now handles the dynamic routing logic (calculating the target Computing Unit host) and injects it via the `Host` header.
    *   Envoy Gateway uses a `SecurityPolicy` to delegate authentication to the Access Control Service and then routes authorized traffic to the backend using the dynamic `Host` header.

3.  **New Kubernetes Resources**:
    
    *   `bin/k8s/templates/gateway.yaml`: Defines the `Gateway` resource, configuring listeners for HTTP, HTTPS, and MinIO. Handles TLS termination using Let's Encrypt via cert-manager.
    
    *   `bin/k8s/templates/routes.yaml`: Defines `HTTPRoute` resources.
        *   **Static Routes**: Standard path-based routing for Texera services (Webserver, API, etc.).
        *   **Dynamic Routes**: Captures regex paths for Computing Units and delegates them to the dynamic backend.
    
    *   `bin/k8s/templates/backend.yaml`: Defines a `Backend` resource of type `DynamicResolver`. This allows Envoy to route to targets defined dynamically (e.g., by the ExtAuth service modifying headers) rather than static Kubernetes services.
    
    *   `bin/k8s/templates/security-policy.yaml`: Defines the `SecurityPolicy` that attaches to the dynamic routes. It configures the External Authorization filter to point to the `access-control-service`.
    
    *   `bin/k8s/templates/eg-config-hook.yaml`: A **Helm Hook** (pre-install/pre-upgrade) that automatically patches the Envoy Gateway configuration to enable necessary features (`enableBackend`, `enableEnvoyPatchPolicy`) which are disabled by default. It ensures the environment is correctly configured without manual intervention.

4.  **Service Updates**:
    *   **Access Control Service**: Updated `AccessControlResource.scala` to compute and set the upstream `Host` header for authorized requests, enabling Envoy to route to the correct Computing Unit pod.

### Any related issues, documentation, discussions?
<!--
Please use this section to link other resources if not mentioned already.
  1. If this PR fixes an issue, please include `Fixes #1234`, `Resolves #1234`
     or `Closes #1234`. If it is only related, simply mention the issue number.
  2. If there is design documentation, please add the link.
  3. If there is a discussion in the mailing list, please add the link.
-->


### How was this PR tested?
<!--
If tests were added, say they were added here. Or simply mention that if the PR 
is tested with existing test cases.  Make sure to include/update test cases that
check the changes thoroughly including negative and positive cases if possible.
If it was tested in a way different from regular unit tests, please clarify how
you tested step by step, ideally copy and paste-able, so that other reviewers can
test and check, and descendants can verify in the future. If tests were not added, 
please describe why they were not added and/or why it was difficult to add. 
-->

Tested on the production RKE2 cluster (`cherry00.ics.uci.edu`):

1.  **Deployment**:
    *   Performed `helm upgrade`. Verified `eg-config-hook` ran successfully and patched the Envoy Gateway config.
    *   Verified `ingress-nginx` and old `envoy` resources were removed.
    *   Verified `Envoy Gateway` LoadBalancer acquired the public IP.

2.  **Connectivity & SSL**:
    *   Accessed `https://cherry00.ics.uci.edu` (Texera UI) - **Success**.
    *   Accessed `https://minio-cherry00.ics.uci.edu` (MinIO Console) - **Success**.
    *   Verified SSL certificates were automatically provisioned and valid.

3.  **Functionality**:
    *   **Login/Collaboration**: Verified User login and WebSocket functionality.
    *   **Workflow Execution**: Ran a workflow requiring Computing Units. Verified that the `Access Control Service` correctly authenticated requests and the dynamic routing via Envoy Gateway sent traffic to the correct transient execution pods.

### Was this PR authored or co-authored using generative AI tooling?
<!--
If generative AI tooling has been used in the process of authoring this PR, 
please include the phrase: 'Generated-by: ' followed by the name of the tool 
and its version. If no, write 'No'. 
Please refer to the [ASF Generative Tooling Guidance](https://www.apache.org/legal/generative-tooling.html) for details.
-->
Generated-by: Antigravity
