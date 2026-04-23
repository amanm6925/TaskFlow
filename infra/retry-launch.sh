#!/usr/bin/env bash
# Retry-launches an Always-Free Ampere A1 VM in ap-hyderabad-1 until OCI has
# capacity. On success, prints public IP and announces via macOS `say`.

set -u

COMPARTMENT="ocid1.tenancy.oc1..aaaaaaaaxsxy3uuraaedqhel4zekfb6qfxkjg2wmoh3xnmbihcaorom4jhiq"
AD="Oqhf:AP-HYDERABAD-1-AD-1"
SUBNET="ocid1.subnet.oc1.ap-hyderabad-1.aaaaaaaadck4qghsh7d2orpnsr5kpu7vwvnqjlyz2tqm6bchtqdsfmbkvjkq"
IMAGE="ocid1.image.oc1.ap-hyderabad-1.aaaaaaaay77sikrrnxr4fbgewjoigqnrpgjqr6yy6s7smpt6qzte4a226uba"
SHAPE="VM.Standard.E2.1.Micro"
SSH_KEY="$HOME/.ssh/id_ed25519.pub"
NAME="taskflow-vm"
SLEEP_SECONDS=60

attempt=0
while true; do
  attempt=$((attempt + 1))
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$ts] attempt #$attempt — launching $NAME ..."

  out=$(oci compute instance launch \
    --compartment-id "$COMPARTMENT" \
    --availability-domain "$AD" \
    --shape "$SHAPE" \
    --image-id "$IMAGE" \
    --subnet-id "$SUBNET" \
    --assign-public-ip true \
    --display-name "$NAME" \
    --ssh-authorized-keys-file "$SSH_KEY" \
    --wait-for-state RUNNING \
    2>&1)
  rc=$?

  if [ $rc -eq 0 ]; then
    instance_id=$(echo "$out" | grep -o 'ocid1.instance[^"]*' | head -1)
    public_ip=$(oci compute instance list-vnics --instance-id "$instance_id" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
    echo ""
    echo "================================================"
    echo "SUCCESS after $attempt attempts"
    echo "Instance OCID: $instance_id"
    echo "Public IP:     $public_ip"
    echo "SSH command:   ssh ubuntu@$public_ip"
    echo "================================================"
    say "VM ready" 2>/dev/null || true
    exit 0
  fi

  if echo "$out" | grep -qiE 'out of (host )?capacity|TooManyRequests|InternalError|timed out|ConnectionError|RequestException|ServiceUnavailable|BadGateway|Service is temporarily unavailable|503|502|504'; then
    reason=$(echo "$out" | grep -oiE 'out of host capacity|timed out|ServiceUnavailable|TooManyRequests|InternalError|BadGateway' | head -1)
    echo "[$ts] transient (${reason:-unknown}) — retry in ${SLEEP_SECONDS}s"
  else
    echo ""
    echo "================================================"
    echo "PERMANENT FAILURE (not a capacity error). Stopping."
    echo "$out"
    echo "================================================"
    say "VM launch failed" 2>/dev/null || true
    exit 1
  fi

  sleep $SLEEP_SECONDS
done
