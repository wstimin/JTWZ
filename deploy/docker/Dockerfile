FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /opt/jtwz
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /src/dist ./dist
COPY --from=build /src/dist-server ./dist-server
RUN mkdir -p data/backups data/storage data/site-releases data/temp data/brand-assets data/task-artifacts data/updates \
  && chown -R node:node /opt/jtwz
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
