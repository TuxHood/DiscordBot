echo "Activating virtual environment..."
source /root/arisu-venv/bin/activate

echo "Backing up local database..."
cp -u servers_info/main.db servers_info/main.db.bak

echo "Pulling latest code..."
git pull origin main

echo "Starting bot..."
exec python Arisu.py
