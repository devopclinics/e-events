# Ansible — Ubuntu Server Resource Utilization

Checks real-time CPU, memory, disk, and network utilization on the target Ubuntu server and prints the results to the terminal. Nothing is written to the server.

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

To prompt for a sudo password (if the remote user is not password-less sudo):

```bash
ansible-playbook -i inventory/hosts.ini playbooks/server-inventory.yml -K
```

## What is checked

| Section | Metrics |
|---------|---------|
| **CPU** | Load averages (uptime), utilization % (user/system/idle/iowait via vmstat), top 10 processes by CPU |
| **Memory** | Total / used / free / available / swap (free -h), top 10 processes by memory |
| **Disk** | Filesystem usage per mount (size / used / available / %), I/O statistics (iostat) |
| **Network** | TX/RX bytes and packet counts per interface |

Results are printed directly to the Ansible output — nothing is created on the server or control node.
