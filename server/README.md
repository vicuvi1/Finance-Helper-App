# Finance Helper bot server

Keeps your Finance Helper Telegram bot on 24/7 on your own server and gives
the desktop app a live link to it. It runs next to Hermes as its own small
container (no packages, about 30 MB of memory).

```
Phone (Telegram) ──► Telegram ──► this server (always on, the only reader of the bot)
                                     │  keeps every message until the app logs it
                                     │  PC off: answers at once (saved / last numbers)
                                     ▼
                           Finance Helper on your PC
                           (a live link: messages arrive within a second,
                            the app sends back a short snapshot of your numbers)
```

## Use a different bot from Hermes

One Telegram bot can be read by only one program. If Hermes already uses a
bot, keep that one for Hermes; Finance Helper uses its own bot (the one you
linked in the app).

## Start it

```sh
git clone https://github.com/vicuvi1/Finance-Helper-App.git
cd Finance-Helper-App/server
docker compose up -d --build
docker compose logs finance-bot     # copy the key it prints
```

Your data stays in `server/data/state.json` (only on this server): the bot
token, your chat, messages waiting for the app, and the last snapshot.

## Let the PC reach it (pick one)

- **Tailscale (easiest, nothing open to the internet):** install Tailscale
  on the server and the PC, then in the app use
  `http://<server-name>:8787` and change the port line in
  `docker-compose.yml` to `"8787:8787"` (Tailscale encrypts the traffic).
- **Your domain with HTTPS:** put it behind Caddy or the proxy you already
  use, e.g. in a Caddyfile: `money.example.com { reverse_proxy 127.0.0.1:8787 }`,
  then use `https://money.example.com` in the app.

## Connect the app

Finance Helper → Settings → Telegram & Binance → **My own server**: paste the
address and the key, press **Connect**. The app stops reading Telegram
itself and uses the server from then on.

## Update it

```sh
cd Finance-Helper-App && git pull && cd server && docker compose up -d --build
```
