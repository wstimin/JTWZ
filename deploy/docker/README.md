# Docker 部署

1. 从 `.env.example` 复制 `.env`，设置管理员密码、`APP_SECRET`、公网域名和生产存储。
2. 设置 `JTWZ_DOMAIN` 为已经解析到服务器的公网域名。
3. 在仓库根目录执行：

```bash
docker compose -f deploy/docker/docker-compose.yml up -d --build
```

应用数据保存在 `jtwz-data` volume；Caddy 等待应用健康后再代理，并自动管理 HTTPS。无域名测试时可使用 `localhost`，正式公网部署必须使用真实域名。
