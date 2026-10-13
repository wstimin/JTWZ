FROM node:22-bookworm-slim
WORKDIR /opt/jtwz
ENV NODE_ENV=production
COPY app/package*.json ./
RUN npm ci --omit=dev
COPY app/dist ./dist
COPY app/dist-server ./dist-server
RUN mkdir -p data/backups data/storage data/site-releases data/temp data/brand-assets data/task-artifacts data/updates \
  && chown -R node:node /opt/jtwz
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
