# RKE2 Removal Plan

## Phase 1: Remove RKE2 ✅ COMPLETED

### Step 1: Stop RKE2 Services ✅
- [x] Stop rke2-server service
- [x] Stop rke2-agent service (if running)
- [x] Kill any remaining RKE2 processes

### Step 2: Remove RKE2 Binaries ✅
- [x] Remove /usr/local/bin/rke2
- [x] Remove RKE2 data binaries in /var/lib/rancher/rke2/data/

### Step 3: Remove RKE2 Scripts and Configuration ✅
- [x] Remove /etc/rancher/rke2/ directory
- [x] Remove /var/lib/rancher/rke2/ directory
- [x] Remove systemd units for rke2-server and rke2-agent
- [x] Clean up /etc/rancher/node/

### Step 4: Clean up Runtime ✅
- [x] Remove /run/k3s/ directory (partially, some mounts busy)
- [x] Remove K3s socket files

### Step 5: Remove User Configuration ✅
- [x] Remove ~/.kube/config and cache

## Phase 2: Install K3s (After Phase 1 completes) ✅ COMPLETED
- Install K3s single-node cluster ✅ INSTALLED v1.34.3+k3s1
- Verify kubectl access ✅ VERIFIED - Working correctly
- Test basic commands ✅ ALL SYSTEMS OPERATIONAL

### K3s Cluster Status:
- Node: k8s-master (Ready, control-plane)
- K3s Version: v1.34.3+k3s1
- System Pods: All running (coredns, traefik, local-path-provisioner, metrics-server)

## Notes:
- Running as: ops (sudo access available)
- RKE2 processes are currently running (PID 17805)
- etcd data exists at /var/lib/rancher/rke2/server/db/etcd/

