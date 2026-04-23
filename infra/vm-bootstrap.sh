#!/usr/bin/env bash
# Run ONCE on a fresh Oracle Ubuntu VM. Idempotent — safe to re-run.
set -euo pipefail

echo "==> 1/5 wait for any background apt to finish"
while sudo fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1; do
  echo "   apt is busy, waiting..."
  sleep 5
done

echo "==> 2/5 update system packages"
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

echo "==> 3/5 set up 2 GB swap (essential for 1 GB RAM VMs)"
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  echo "swap created."
else
  echo "swap already configured."
fi
free -h

echo "==> 4/5 install Docker engine + compose plugin"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker ubuntu
  echo "Docker installed. You'll need to log out + back in for the group change."
else
  echo "Docker already installed."
fi
docker --version || true

echo "==> 5/5 open ports 80 + 443 at the host firewall (Oracle image blocks them)"
sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT  || true
sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT || true
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null
sudo netfilter-persistent save >/dev/null

echo ""
echo "================================================================"
echo "DONE. Now log out and back in (so 'ubuntu' picks up docker group)"
echo "  exit"
echo "  ssh ubuntu@<this-vm>"
echo "Then verify:"
echo "  docker ps             # should print empty list, no permission error"
echo "  free -h               # should show 2.0G of swap"
echo "================================================================"
