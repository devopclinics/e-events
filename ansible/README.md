# Ansible — Ubuntu Server Inventory

Collects a comprehensive snapshot of the Ubuntu server's system state and saves a plain-text report to your local `/tmp/` directory.

## Prerequisites

- [Ansible](https://docs.ansible.com/ansible/latest/installation_guide/index.html) installed on your control machine
- SSH access to the target server (key-based auth recommended)

```bash
pip install ansible        # or: brew install ansible
```

## Quick start

### 1. Update the inventory

Edit `inventory/hosts.ini` and replace `YOUR_SERVER_IP` with your server's IP address or hostname, and set `ansible_user` to the appropriate SSH user (typically `ubuntu` for Ubuntu cloud instances):

```ini
[ubuntu_servers]
events-server ansible_host=203.0.113.10 ansible_user=ubuntu
```

### 2. Run the playbook

```bash
ansible-playbook -i inventory/hosts.ini playbooks/server-inventory.yml
```

To target a specific host from the inventory group:

```bash
ansible-playbook -i inventory/hosts.ini playbooks/server-inventory.yml --limit events-server
```

To prompt for a sudo password (if the remote user is not password-less sudo):

```bash
ansible-playbook -i inventory/hosts.ini playbooks/server-inventory.yml -K
```

### 3. Read the report

The report is saved locally to:

```
/tmp/server-inventory-<hostname>.txt
```

## What is collected

| Section | Details |
|---------|---------|
| **OS & Kernel** | Distribution, version, codename, kernel, architecture, uptime, timezone |
| **Hardware** | CPU (lscpu), memory (free), disk usage (df), block devices (lsblk) |
| **Network** | Interfaces, routing table, listening ports, DNS config |
| **Users & Groups** | Non-system local users, sudo group members |
| **Services** | Running, failed, and enabled systemd services |
| **Packages** | Total installed count, manually installed packages, pending security updates |
| **Docker** | Version, running containers, all containers, images, disk usage |
| **Security** | UFW firewall rules, last 10 logins |
