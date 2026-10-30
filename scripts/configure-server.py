#!/usr/bin/env python3
# Generate local production secrets. Never overwrites an existing configuration.
from pathlib import Path
import secrets,os,argparse
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--chat-host',default='chat.innaware.net');p.add_argument('--meet-host',default='meet.chat.innaware.net');p.add_argument('--acme-email',required=True);args=p.parse_args()
for value in [args.chat_host,args.meet_host]:
 if not value or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-' for c in value):raise SystemExit('Hostnames must contain only letters, digits, dots and hyphens.')
if '\n' in args.acme_email or '=' in args.acme_email or '@' not in args.acme_email:raise SystemExit('Provide a valid administrator email address.')
env=root/'.env.production';config=root/'deploy/livekit.generated.yaml'
if env.exists() or config.exists():raise SystemExit('Configuration already exists; no files changed. Keep your existing secrets.')
password=secrets.token_hex(32);key='CF'+secrets.token_hex(12);secret=secrets.token_hex(32)
content=f'''NODE_ENV=production
PUBLIC_URL=https://{args.chat_host}
CHAT_HOST={args.chat_host}
MEET_HOST={args.meet_host}
ACME_EMAIL={args.acme_email}
POSTGRES_PASSWORD={password}
TRUST_PROXY=172.30.48.1
ALLOW_REGISTRATION=true
ORG_STORAGE_LIMIT_MB=1024
# REQUIRED: replace these SMTP settings before deployment.
SMTP_HOST=mail.smtp2go.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=REPLACE_WITH_YOUR_SMTP_USERNAME
SMTP_PASSWORD=REPLACE_WITH_YOUR_SMTP_PASSWORD
MAIL_FROM=ChatFinity <hello@innaware.net>
LIVEKIT_URL=wss://{args.meet_host}
LIVEKIT_INTERNAL_URL=http://host.docker.internal:7880
LIVEKIT_API_KEY={key}
LIVEKIT_API_SECRET={secret}
'''
livekit=f'''port: 7880
log_level: info
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true
keys:
  {key}: {secret}
room:
  auto_create: false
  empty_timeout: 300
  max_participants: 30
'''
for path,text in [(env,content),(config,livekit)]:
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
 with os.fdopen(fd,'w') as stream:stream.write(text)
print('Created .env.production and deploy/livekit.generated.yaml with private file permissions.')
print('Edit SMTP settings, confirm DNS/firewall/reverse-proxy setup, then follow docs/SERVER2.md.')
