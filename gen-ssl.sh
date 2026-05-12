#!/bin/bash
# Script tạo SSL self-signed certificate cho VPS
# Chạy trên VPS: bash gen-ssl.sh

mkdir -p ssl
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 3650 -nodes \
  -subj "/C=VN/ST=HN/L=Hanoi/O=VPS/OU=API/CN=localhost" \
  -addext "subjectAltName=IP:$(curl -s ifconfig.me)"

echo "✅ SSL cert đã tạo xong tại ./ssl/"
echo "📌 Restart API: pm2 restart gsc-api"
