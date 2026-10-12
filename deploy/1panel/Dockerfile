FROM node:22-bookworm-slim
WORKDIR /opt/jtwz
ENV NODE_ENV=production
COPY app/package*.json ./
RUN npm ci --omit=dev
COPY app/dist ./dist
COPY app/dist-server ./dist-server
RUN mkdir -p data/backups data/storage data/site-releases data/temp data/brand-assets data/updates
EXPOSE 8787
CMD ["node", "dist-server/index.js"]
