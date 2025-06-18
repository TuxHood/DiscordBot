#!/bin/bash

echo "Activating virtual environment..."
source /root/arisu-venv/bin/activate

echo "Installing Python dependencies..."
pip install -r requirements.txt --quiet

echo "Backing up local database..."
cp -u servers_info/main.db servers_info/main.db.bak

echo "Checking for local changes to update.sh..."
if [[ $(git status --porcelain update.sh) ]]; then
  echo "Committing local changes to update.sh..."
  git add update.sh
  git commit -m "Auto-commit: local update.sh changes"
fi

echo "Pulling latest code..."
git pull --no-rebase --no-edit

echo "Starting bot..."
exec python Arisu.py
