#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HOME/.config/nf-division-notifier.env"
SERVICE_TARGET="$HOME/.config/systemd/user/nf-division-notifier.service"

mkdir -p "$HOME/.config/systemd/user"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$PROJECT_DIR/tools/division_notifier.env.example" "$ENV_FILE"
  echo "Created env file: $ENV_FILE"
  echo "Please edit it and set TBA_API_KEY + DIVISION_EVENT_KEYS."
fi

cp "$PROJECT_DIR/tools/nf-division-notifier.service" "$SERVICE_TARGET"
echo "Installed service file: $SERVICE_TARGET"

systemctl --user daemon-reload
systemctl --user enable --now nf-division-notifier.service
echo
echo "Notifier enabled and started."
echo "Check status:  systemctl --user status nf-division-notifier.service"
echo "Tail logs:     journalctl --user -u nf-division-notifier.service -f"
