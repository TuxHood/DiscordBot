echo "Activating virtual environment..."
source /root/arisu-venv/bin/activate

echo "Installing Python dependencies..."
pip install -r requirements.txt

echo "Backing up local database..."
cp -u servers_info/main.db servers_info/main.db.bak

echo "Pulling latest code..."
git git pull --no-rebase

echo "Starting bot..."
exec python Arisu.py
