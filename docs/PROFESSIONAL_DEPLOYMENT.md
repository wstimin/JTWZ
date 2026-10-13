# JTWZ 专业版部署教程

本文只描述生产部署。开发环境请先阅读仓库根目录的 README。

## 1. 部署边界

JTWZ 由三个运行边界组成：

```text
公开站（dist/public） ─┐
管理端（dist/admin）  ─┼─ 反向代理 ─ Node API（dist-server） ─ SQLite / 对象存储
跳转与站点域名       ─┘                         │
                                             DNS / HTTPS / 备份
```

- 公开站只提供首页、公告、软件下载中心和软件详情，不包含管理入口。
- 管理端独立构建，所有写操作都需要 HttpOnly 会话、SameSite Cookie、CSRF 令牌、来源校验和服务端角色权限校验。
- 安全中心支持所有者、管理员、内容编辑、只读审计四级角色，可选 TOTP 双重验证、一次性恢复码、设备会话撤销和新设备登录告警。
- 每次请求生成或接受合法的请求 ID；审计日志包含管理员、IP 和请求 ID，密码、令牌、密钥与签名参数会自动脱敏。
- API 负责鉴权、域名跳转、站点发布、软件分发、统计、审计和备份。
- 安装包通过对象存储签名地址直传/直下；大文件不经过普通业务请求中转。

## 2. 推荐域名

```text
https://www.example.com       公开展示端
https://admin.example.com     管理后台
https://api.example.com       API 与运行时域名入口
```

自定义跳转域名和静态网站域名应解析到反向代理，再由 API 按请求 Host 和 Path 执行跳转或提供已发布站点。

## 3. 使用发行包安装

正式包从 [GitHub Releases](https://github.com/wstimin/JTWZ/releases) 获取。源码仓库不包含生成的 ZIP/TAR。

### 一键部署（推荐）

一键入口支持远程一行命令：

```bash
bash <(curl -fsSL -H 'Accept: application/vnd.github.raw' 'https://api.github.com/repos/wstimin/JTWZ/contents/deploy/one-click/install.sh?ref=main')
```

也可以下载 `jtwz-one-click-vX.Y.Z.tar.gz` 后执行 `sudo ./install.sh`。安装器会从多个外部服务自动识别公网 IP，显示结果并允许改填公网域名；识别失败才要求手动输入。它拒绝回环、私网、链路本地和 CGNAT 地址。安装完成后使用 `sudo jt` 调出交互菜单。菜单可检查 GitHub 最新正式版本，更新前自动创建完整备份，并同时验证 Ed25519 发布签名和 SHA-256；数据库迁移或健康检查失败时恢复上一版程序。

未填写域名、直接使用公网 IP 时，服务对外监听 TCP `8787`，完整管理地址为 `http://公网IP:8787/{管理后缀}/login`。管理后缀在安装时设置，默认 `/admin`，也可通过后台或 `jt admin-path set` 修改。安装器会处理 UFW/firewalld 并执行健康检查；云平台安全组需要单独放行 TCP `8787`。

### 宝塔

```bash
unzip jtwz-baota-vX.Y.Z.zip
cd jtwz-baota-vX.Y.Z
sudo ./install.sh
```

安装向导会写入生产 `.env`、构建目录、systemd 服务和 Nginx 配置。完成后将 DNS 指向服务器，再通过管理域名登录。

### 1Panel

```bash
tar -xzf jtwz-1panel-vX.Y.Z.tar.gz
cd jtwz-1panel-vX.Y.Z
sudo ./install.sh
```

安装器会生成 Compose 环境并启动容器，应用数据保存在 Docker volume。域名和 HTTPS 可在 1Panel 反向代理中绑定。

### Docker Compose

`deploy/docker/docker-compose.yml` 提供非 root 应用容器、持久化 volume、健康检查，以及等待应用健康后才接流量的 Caddy HTTPS 反向代理。设置 `.env` 和 `JTWZ_DOMAIN` 后，从仓库根目录执行 `docker compose -f deploy/docker/docker-compose.yml up -d --build`。

独立服务器和宝塔安装同样使用专用 `jtwz` 系统用户运行主服务，并启用 systemd 文件系统、设备、内核和提权限制。只有签名更新器可通过最小 sudo 规则临时以 root 切换程序文件；更新器会再次核验暂存路径、SHA-256 与 Ed25519 签名。

## 4. 源码部署

```bash
npm ci
cp .env.example .env
npm run check
npm run build
npm start
```

生产 `.env` 至少需要：

```dotenv
NODE_ENV=production
ADMIN_USERNAME=替换为管理员账号
ADMIN_PASSWORD=替换为至少 6 位密码
APP_SECRET=替换为至少 32 字节随机密钥
ADMIN_BASE_PATH=/admin
```

不同域名部署时设置：

```dotenv
PUBLIC_APP_ORIGIN=https://www.example.com
ADMIN_APP_ORIGIN=https://admin.example.com
ADMIN_BASE_PATH=/jtwz-console
```

推荐由反向代理把整个站点转发到 `127.0.0.1:8787`，由 JTWZ 在同源下分发公开端、可配置管理入口和 `/api`。这样不需要单独维护对外 API 域名，也能避免跨域 Cookie 问题。

## 5. 反向代理与 HTTPS

仓库提供 `deploy/nginx.conf`、`deploy/nginx.professional.conf.template` 和 `deploy/Caddyfile`。上线顺序建议为：

1. 先完成 DNS 解析和 HTTP 反向代理；
2. 确认公开站、管理端和 API 健康检查均返回 200；
3. 使用 certbot 或面板签发证书；
4. 将 HTTP 重定向到 HTTPS；
5. 在管理端系统设置中再次检查公开域名、管理域名和 API 地址。

## 6. 对象存储与备份

开发和小规模部署可以使用本地存储。生产大文件推荐设置 `STORAGE_PROVIDER=s3`，并配置 R2、OSS、COS 或其他 S3 兼容服务。v3 迁移包包含管理员账号哈希、运行配置与密钥、数据库业务数据、统计记录、静态网站全部版本、品牌资源和安装包对象，并带清单与逐文件 SHA-256。上传恢复前会先创建回滚备份；数据库、文件或配置任一环节失败都会自动恢复原网站。迁移包包含敏感配置，必须按服务器凭据级别保管。

## 7. 发布新版本

首次正式发布前运行 `node scripts/generate-update-keys.mjs`。生成的 `release-signing-private.pem` 已被 Git 忽略，只能进入 GitHub Secret `JTWZ_UPDATE_PRIVATE_KEY_B64`；`deploy/installer/update-public-key.pem` 需要提交，安装器会自动写入服务器配置。私钥丢失时必须生成新密钥对并发布一次信任更新，不能把私钥提交到仓库。

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

GitHub Actions 会构建三种安装包，发布 `SHA256SUMS`，并使用仓库 Secret `JTWZ_UPDATE_PRIVATE_KEY_B64` 生成 `update-manifest.json`。服务器在 `UPDATE_PUBLIC_KEY` 中只配置对应的 Ed25519 公钥；签名或 SHA-256 任一不匹配都会拒绝更新。每次正式发布前必须先递增 `package.json`、`package-lock.json` 和安装包 manifest 的版本；只有备份格式确实不再兼容旧版本时，才调整 `server/backup.ts` 的最低兼容版本。

`professional-quality-gate` 工作流会在 Node 22/24 上执行类型检查、构建、阶段 4/5/6 隔离测试与 HTTP 冒烟测试，并验证全部 Shell 脚本、Docker Compose 清单、非 root 容器构建和容器健康检查。真实公网 IP、域名 HTTPS、宝塔和 1Panel 仍属于发布前实机验收项，不能用 CI 结果替代。
