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
- 管理端独立构建，所有写操作都需要 HttpOnly 会话和服务端权限校验。
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
bash <(curl -fsSL https://raw.githubusercontent.com/wstimin/JTWZ/main/deploy/one-click/install.sh)
```

也可以下载 `jtwz-one-click-vX.Y.Z.tar.gz` 后执行 `sudo ./install.sh`。安装器会从多个外部服务自动识别公网 IP，显示结果并允许改填公网域名；识别失败才要求手动输入。它拒绝回环、私网、链路本地和 CGNAT 地址。安装完成后使用 `sudo jt` 调出交互菜单。

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
ADMIN_PASSWORD=替换为至少 12 位随机密码
APP_SECRET=替换为至少 32 字节随机密钥
```

不同域名部署时设置：

```dotenv
PUBLIC_APP_ORIGIN=https://www.example.com
ADMIN_APP_ORIGIN=https://admin.example.com
VITE_PUBLIC_SITE_URL=https://www.example.com
VITE_ADMIN_SITE_URL=https://admin.example.com
VITE_API_BASE_URL=https://api.example.com
```

同域名部署时保留默认 `/admin` 路径，并让反向代理把 `/api` 转发到 `127.0.0.1:8787`。

## 5. 反向代理与 HTTPS

仓库提供 `deploy/nginx.conf`、`deploy/nginx.professional.conf.template` 和 `deploy/Caddyfile`。上线顺序建议为：

1. 先完成 DNS 解析和 HTTP 反向代理；
2. 确认公开站、管理端和 API 健康检查均返回 200；
3. 使用 certbot 或面板签发证书；
4. 将 HTTP 重定向到 HTTPS；
5. 在管理端系统设置中再次检查公开域名、管理域名和 API 地址。

## 6. 对象存储与备份

开发和小规模部署可以使用本地存储。生产大文件推荐设置 `STORAGE_PROVIDER=s3`，并配置 R2、OSS、COS 或其他 S3 兼容服务。备份包含数据库、静态网站版本、品牌资源和安装包对象；恢复前会校验归档大小和 SHA-256，并创建回滚点。

## 7. 发布新版本

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Actions 会构建三种安装包并发布 `SHA256SUMS`。发布前请同步 `package.json`、安装包 manifest 和 `server/backup.ts` 的最低兼容版本。
