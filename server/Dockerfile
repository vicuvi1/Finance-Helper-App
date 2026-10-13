FROM node:22-alpine
WORKDIR /app
COPY finance-bot.mjs ./
ENV DATA_DIR=/data PORT=8787 TZ=Europe/Chisinau
VOLUME /data
EXPOSE 8787
USER node
CMD ["node", "finance-bot.mjs"]
